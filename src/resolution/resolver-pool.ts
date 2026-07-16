/**
 * ResolverPool — main-thread client for the parallel-resolution workers.
 *
 * resolveBatch() splits a rowid-ordered batch into ordered chunks, fans the
 * chunks across the pool, and reassembles the results IN CHUNK ORDER, so the
 * caller's admission (edge inserts, row cleanup, failure parking, deferred
 * post-pass queues) is byte-for-byte the sequence the single-threaded loop
 * would have produced. Any worker failure fails the batch — the caller falls
 * back to the sequential path. Kill switch: CODEGRAPH_NO_PARALLEL_RESOLVE=1.
 */

import { Worker } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { UnresolvedReference } from '../types';
import type { ResolvedRef, UnresolvedRef } from './types';

export interface ChunkResult {
  resolved: ResolvedRef[];
  unresolved: UnresolvedRef[];
  deferredChain: UnresolvedRef[];
  deferredThisMember: UnresolvedRef[];
  byMethod: Record<string, number>;
}

interface PoolWorker {
  worker: Worker;
  ready: Promise<void>;
  busy: number;
}

const MIN_PARALLEL_BATCH = 1000;
const CHUNK_SIZE = 500;

/**
 * Minimum TOTAL pending refs before the pool is created at all. Pool boot
 * (module load + readonly DB open + framework detect + cache warm, times N
 * workers) costs real CPU that CONTENDS with sequential resolution on the
 * same cores — measured on a medium repo (~40k refs, ~1.2s of resolution)
 * the pool made indexing slower. It pays off when resolution runs for tens
 * of seconds to minutes (large JVM/Spring-class repos). Override:
 * CODEGRAPH_PARALLEL_RESOLVE_MIN=<refs> (0 forces the pool on).
 */
export function minRefsForPool(): number {
  const raw = process.env.CODEGRAPH_PARALLEL_RESOLVE_MIN;
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 150_000;
}

export class ResolverPool {
  private workers: PoolWorker[] = [];
  private nextId = 0;
  private waiters = new Map<number, { resolve: (r: ChunkResult) => void; reject: (e: Error) => void }>();
  private failed: Error | null = null;

  /**
   * Create a pool when the compiled worker exists (absent when running from
   * source in tests → callers use the sequential path), the kill switch is
   * off, and the machine has cores to spare. Returns null otherwise.
   */
  static tryCreate(dbPath: string, projectRoot: string): ResolverPool | null {
    if (process.env.CODEGRAPH_NO_PARALLEL_RESOLVE === '1') return null;
    const workerScript = path.join(__dirname, 'resolver-worker.js');
    if (!fs.existsSync(workerScript)) return null;
    const size = Math.max(1, Math.min(os.cpus().length - 2, 6));
    if (size < 2) return null;
    try {
      return new ResolverPool(workerScript, dbPath, projectRoot, size);
    } catch {
      return null;
    }
  }

  private constructor(workerScript: string, dbPath: string, projectRoot: string, size: number) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScript);
      let readyResolve!: () => void;
      let readyReject!: (e: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      const pw: PoolWorker = { worker, ready, busy: 0 };
      worker.on('message', (msg: { type: string; id?: number; message?: string } & Partial<ChunkResult>) => {
        if (msg.type === 'ready') {
          readyResolve();
        } else if (msg.type === 'result' && msg.id !== undefined) {
          pw.busy--;
          const waiter = this.waiters.get(msg.id);
          this.waiters.delete(msg.id);
          waiter?.resolve({
            resolved: msg.resolved!,
            unresolved: msg.unresolved!,
            deferredChain: msg.deferredChain!,
            deferredThisMember: msg.deferredThisMember!,
            byMethod: msg.byMethod!,
          });
        } else if (msg.type === 'error') {
          pw.busy--;
          const err = new Error(`resolver worker: ${msg.message}`);
          if (msg.id !== undefined && this.waiters.has(msg.id)) {
            const waiter = this.waiters.get(msg.id)!;
            this.waiters.delete(msg.id);
            waiter.reject(err);
          } else {
            this.fail(err);
          }
        }
      });
      worker.on('error', (err) => {
        this.fail(err instanceof Error ? err : new Error(String(err)));
        readyReject(this.failed!);
      });
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.fail(new Error(`resolver worker exited with code ${code}`));
          readyReject(this.failed!);
        }
      });
      worker.postMessage({ type: 'open', dbPath, projectRoot });
      this.workers.push(pw);
    }
  }

  private fail(err: Error): void {
    if (!this.failed) this.failed = err;
    for (const [, waiter] of this.waiters) waiter.reject(this.failed);
    this.waiters.clear();
  }

  /** Whether this batch is worth fanning out. */
  static worthParallel(batchLength: number): boolean {
    return batchLength >= MIN_PARALLEL_BATCH;
  }

  async ready(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.ready));
  }

  /**
   * Resolve `refs` across the pool. Chunks preserve input order; the returned
   * arrays are the in-order concatenation of the chunk results.
   */
  async resolveBatch(refs: UnresolvedReference[]): Promise<ChunkResult> {
    if (this.failed) throw this.failed;
    const chunkPromises: Promise<ChunkResult>[] = [];
    for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
      const chunk = refs.slice(i, i + CHUNK_SIZE);
      const id = this.nextId++;
      // Least-busy dispatch keeps workers evenly loaded regardless of chunk
      // cost variance; result order is fixed by the promise array, not by
      // completion order.
      const pw = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      pw.busy++;
      chunkPromises.push(
        new Promise<ChunkResult>((resolve, reject) => {
          this.waiters.set(id, { resolve, reject });
          pw.worker.postMessage({ type: 'resolve', id, refs: chunk });
        })
      );
    }
    const chunks = await Promise.all(chunkPromises);
    const out: ChunkResult = { resolved: [], unresolved: [], deferredChain: [], deferredThisMember: [], byMethod: {} };
    for (const c of chunks) {
      out.resolved.push(...c.resolved);
      out.unresolved.push(...c.unresolved);
      out.deferredChain.push(...c.deferredChain);
      out.deferredThisMember.push(...c.deferredThisMember);
      for (const [k, v] of Object.entries(c.byMethod)) out.byMethod[k] = (out.byMethod[k] || 0) + v;
    }
    return out;
  }

  async destroy(): Promise<void> {
    await Promise.all(
      this.workers.map(
        (pw) =>
          new Promise<void>((resolve) => {
            const t = setTimeout(() => {
              void pw.worker.terminate().then(() => resolve());
            }, 5000);
            pw.worker.once('exit', () => {
              clearTimeout(t);
              resolve();
            });
            pw.worker.postMessage({ type: 'close' });
          })
      )
    );
  }
}
