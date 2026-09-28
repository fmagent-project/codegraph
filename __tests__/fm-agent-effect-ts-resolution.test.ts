/**
 * Effect-TS resolution: calls into a service's members.
 *
 * Upstream names a wrapped function after the binding its result lands in
 * (#1747, PR #2002), so `const helper = Effect.fn("Ns.helper")(…)` is a node
 * named `helper` and a bare `helper()` resolves the ordinary way. What that
 * leaves unresolved is the call Effect code is mostly made of — a service
 * member reached through the service:
 *
 *     const state = yield* SessionRunState.Service
 *     state.assertNotBusy()
 *
 * `state` has no source-level type, and the member lives in an object a
 * factory returns rather than as an export, so neither receiver inference nor
 * import resolution reaches it; a direct `EventV2.readAggregate(…)` on an
 * imported namespace fails the same way. The one place the namespace is
 * written down is the wrapper's string, `Effect.fn("SessionRunState.assertNotBusy")`,
 * on the member's own line. So: take the namespace from the receiver's own
 * nearest declaration, or from the receiver itself when it is a capitalised
 * name; require the calling file to import it; and resolve only a unique
 * member whose wrapper string is `Ns.method`. A shadow, a non-service
 * initializer, a missing import or two candidates decline.
 *
 * Also pinned: a bare call never reaches a wrapper by its string's tail. The
 * fork used to bridge `helper()` to a node named `Ns.helper`, which minted an
 * edge whenever the tail happened to match — `const invoke =
 * Effect.fn("Service.run")(…)` made every bare `run()` a call to it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeGraph } from '../src';

type Edge = { src: string; tgt: string; tgtFile: string };

describe('Effect-TS service member resolution (fork patch)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effect-ts-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (rel: string, body: string) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };

  const load = async (): Promise<Edge[]> => {
    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const db = (cg as any).db.db;
    const edges: Edge[] = db
      .prepare(
        `SELECT s.name src, t.name tgt, t.file_path tgtFile FROM edges e
         JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'calls'`,
      )
      .all();
    cg.close?.();
    return edges;
  };
  const calls = (edges: Edge[], src: string, tgt: string, tgtFile?: string) =>
    edges.some((e) => e.src === src && e.tgt === tgt && (!tgtFile || e.tgtFile === tgtFile));
  const callsAny = (edges: Edge[], src: string, tgt: string) =>
    edges.some((e) => e.src === src && e.tgt === tgt);

  // Two services with a same-named member, so a name alone cannot pick one:
  // only the wrapper string tells them apart.
  const writeServices = () => {
    write(
      'run-state.ts',
      `export const SessionRunState = { Service: null as any };

function makeState() {
  return {
    assertNotBusy: Effect.fn("SessionRunState.assertNotBusy")(function* () {
      return;
    }),
  };
}
export const stateImpl = makeState();
`,
    );
    write(
      'other-state.ts',
      `export const OtherState = { Service: null as any };

function makeOther() {
  return {
    assertNotBusy: Effect.fn("OtherState.assertNotBusy")(function* () {
      return;
    }),
  };
}
export const otherImpl = makeOther();
`,
    );
  };

  it('resolves a member call on a yield*-bound service local', async () => {
    writeServices();
    write(
      'loop.ts',
      `import { SessionRunState } from './run-state';

export const loop = Effect.fn("App.loop")(function* () {
  const state = yield* SessionRunState.Service;
  state.assertNotBusy();
});
`,
    );
    const edges = await load();
    expect(calls(edges, 'loop', 'assertNotBusy', 'run-state.ts')).toBe(true);
    expect(calls(edges, 'loop', 'assertNotBusy', 'other-state.ts')).toBe(false);
  });

  it('resolves a direct call through an imported namespace, and declines without the import', async () => {
    // A module that re-exports itself as its namespace, the way an Effect
    // codebase often spells one; a same-named function elsewhere is the decoy.
    write(
      'event.ts',
      `export * as EventV2 from "./event";

export const readAggregate = Effect.fn("EventV2.readAggregate")(function* (id: string) {
  return id;
});
`,
    );
    write(
      'legacy.ts',
      `export const readAggregate = Effect.fn("EventV1.readAggregate")(function* (id: string) {
  return id;
});
`,
    );
    write(
      'direct.ts',
      `import { EventV2 } from './event';

export const direct = Effect.fn("App.direct")(function* () {
  yield* EventV2.readAggregate("a");
});
`,
    );
    write(
      'unimported.ts',
      `export const unimported = Effect.fn("App.unimported")(function* () {
  yield* EventV2.readAggregate("a");
});
`,
    );
    const edges = await load();
    expect(calls(edges, 'direct', 'readAggregate', 'event.ts')).toBe(true);
    expect(calls(edges, 'direct', 'readAggregate', 'legacy.ts')).toBe(false);
    expect(callsAny(edges, 'unimported', 'readAggregate')).toBe(false);
  });

  it('declines when the receiver is shadowed by a non-service binding', async () => {
    writeServices();
    write(
      'loop.ts',
      `import { SessionRunState } from './run-state';

declare function makeRow(): any;

export const inner = Effect.fn("App.inner")(function* () {
  const state = yield* SessionRunState.Service;
  const nested = Effect.fn("App.nested")(function* () {
    const state = makeRow();
    state.assertNotBusy();
  });
  return nested;
});
`,
    );
    const edges = await load();
    expect(callsAny(edges, 'nested', 'assertNotBusy')).toBe(false);
  });

  it('resolves through one service-factory hop (Ns.Service.create)', async () => {
    write(
      'processor.ts',
      `export const SessionProcessor = { Service: null as any };

function makeProc() {
  return {
    process: Effect.fn("SessionProcessor.process")(function* (m: any) { return m; }),
    create: Effect.fn("SessionProcessor.create")(function* (m: any) { return m; }),
  };
}
export const procImpl = makeProc();
`,
    );
    write(
      'consumer.ts',
      `import { SessionProcessor } from './processor';

export const run = Effect.fn("App.run")(function* (msg: any) {
  const processors = yield* SessionProcessor.Service;
  const processor = yield* processors.create(msg);
  yield* processor.process(msg);
});
`,
    );
    const edges = await load();
    expect(calls(edges, 'run', 'create', 'processor.ts')).toBe(true);
    expect(calls(edges, 'run', 'process', 'processor.ts')).toBe(true);
  });

  it('never resolves a bare call to a wrapper by its string tail', async () => {
    write(
      'svc.ts',
      `function run() { return 2; }

const invoke = Effect.fn("Service.run")(function* () { return 1; });

export default Runtime.handler("x", Effect.fn("cli.api")(function* () { return 1; }));

declare function api(): void;

export function caller() {
  invoke();
  run();
  api();
}
`,
    );
    const edges = await load();
    // The binding names the wrapped function, and the plain `run` keeps its
    // own call.
    expect(calls(edges, 'caller', 'invoke', 'svc.ts')).toBe(true);
    expect(calls(edges, 'caller', 'run', 'svc.ts')).toBe(true);
    // `cli.api` is bound to nothing; no call site can name it.
    expect(callsAny(edges, 'caller', 'cli.api')).toBe(false);
  });
});
