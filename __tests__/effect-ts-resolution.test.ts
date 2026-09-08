/**
 * Effect-TS resolution: wrapper-named functions and service receivers.
 *
 * Two structural gaps this suite pins:
 *
 * 1. `const helper = Effect.fn("Ns.helper")(function* …)` — the extractor
 *    names the function node after the wrapper's debug string (`Ns.helper`),
 *    while call sites use the binding's bare name (`helper(...)`). Local
 *    consts are not indexed as nodes, so nothing is named `helper`: exact
 *    name matching fails outright, or binds a same-named function in an
 *    unrelated file. Resolution bridges the names by suffix — a unique
 *    same-file `Ns.<name>` function visible from the call site's scope —
 *    and declines on ambiguity or cross-scope candidates.
 *
 * 2. `const state = yield* SessionRunState.Service; state.assertNotBusy()` —
 *    the receiver's type lives only in the Effect type system, so no
 *    source-level inference applies. The binding text plus the wrapper
 *    naming convention recover it: the receiver's own nearest declaration
 *    names the service namespace, the file must import it, and the member
 *    must be a unique `Ns.method` node. Shadows and non-service
 *    initializers decline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeGraph } from '../src';

describe('Effect-TS wrapper naming and service receivers', () => {
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

  const load = async () => {
    const cg = await CodeGraph.init(dir, { silent: true });
    await cg.indexAll();
    const db = (cg as any).db.db;
    const edges: { src: string; tgt: string }[] = db
      .prepare(
        `SELECT s.name src, t.name tgt FROM edges e
         JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
         WHERE e.kind = 'calls'`,
      )
      .all();
    const names: string[] = db.prepare(`SELECT name FROM nodes`).all().map((r: any) => r.name);
    cg.close?.();
    return { edges, names };
  };
  const hasCall = (edges: { src: string; tgt: string }[], src: string, tgt: string) =>
    edges.some((e) => e.src === src && e.tgt === tgt);

  it('resolves a bare call to a wrapper-named function-local const', async () => {
    write(
      'svc.ts',
      `function createProcessor() {
  const helper = Effect.fn("Ns.helper")(function* (x: number) {
    return x;
  });

  function caller(a: number) {
    const r = helper(a);
    return r;
  }

  return { caller };
}
export const processor = createProcessor();
`,
    );
    const { edges, names } = await load();
    // Extraction prerequisite: the node carries the wrapper string's name.
    expect(names).toContain('Ns.helper');
    expect(hasCall(edges, 'caller', 'Ns.helper')).toBe(true);
  });

  it('prefers the same-file wrapper target over a cross-file bare name', async () => {
    write(
      'svc.ts',
      `function createProcessor() {
  const helper = Effect.fn("Ns.helper")(function* (x: number) {
    return x;
  });

  function caller(a: number) {
    return helper(a);
  }

  return { caller };
}
export const processor = createProcessor();
`,
    );
    // A unique global bare-named `helper` — exactly the shape that bound
    // `createUserMessage(...)` to a test file before the bridge ran.
    write('other.ts', `export function helper(x: number) { return x + 1; }\n`);
    const { edges } = await load();
    expect(hasCall(edges, 'caller', 'Ns.helper')).toBe(true);
    expect(hasCall(edges, 'caller', 'helper')).toBe(false);
  });

  it('declines when two visible wrapper targets share the tail', async () => {
    write(
      'svc.ts',
      `function createTwo() {
  const helperA = Effect.fn("Ns.helper")(function* () { return 1; });
  const helperB = Effect.fn("Other.helper")(function* () { return 2; });

  function caller() {
    return helper(0);
  }

  return { caller };
}
export const two = createTwo();
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'caller', 'Ns.helper')).toBe(false);
    expect(hasCall(edges, 'caller', 'Other.helper')).toBe(false);
  });

  it('declines a wrapper target visible only in a sibling scope', async () => {
    write(
      'svc.ts',
      `function makeA() {
  const helper = Effect.fn("Ns.helper")(function* () { return 1; });
  return helper;
}

function makeB() {
  function caller() {
    return helper(0);
  }
  return { caller };
}

export const a = makeA();
export const b = makeB();
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'caller', 'Ns.helper')).toBe(false);
  });

  it('resolves a member call on a yield*-bound service local', async () => {
    write(
      'run-state.ts',
      `export const SessionRunState = { Service: null as any };

function makeState() {
  const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* () {
    return;
  });
  return { assertNotBusy };
}
export const stateImpl = makeState();
`,
    );
    write(
      'loop.ts',
      `import { SessionRunState } from './run-state';

const loop = Effect.fn("App.loop")(function* () {
  const state = yield* SessionRunState.Service;
  state.assertNotBusy();
});

export { loop };
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'App.loop', 'SessionRunState.assertNotBusy')).toBe(true);
  });

  it('declines when the receiver is shadowed by a non-service binding', async () => {
    write(
      'run-state.ts',
      `export const SessionRunState = { Service: null as any };

function makeState() {
  const assertNotBusy = Effect.fn("SessionRunState.assertNotBusy")(function* () {
    return;
  });
  return { assertNotBusy };
}
export const stateImpl = makeState();
`,
    );
    write(
      'loop.ts',
      `import { SessionRunState } from './run-state';

declare function makeRow(): any;

const inner = Effect.fn("App.inner")(function* () {
  const state = yield* SessionRunState.Service;
  const nested = Effect.fn("App.nested")(function* () {
    const state = makeRow();
    state.assertNotBusy();
  });
  return nested;
});

export { inner };
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'App.nested', 'SessionRunState.assertNotBusy')).toBe(false);
  });

  it('resolves through one service-factory hop (Ns.Service.create)', async () => {
    write(
      'processor.ts',
      `export const SessionProcessor = { Service: null as any };

function makeProc() {
  const process = Effect.fn("SessionProcessor.process")(function* (m: any) { return m; });
  const create = Effect.fn("SessionProcessor.create")(function* (m: any) {
    return { process };
  });
  return { process, create };
}
export const procImpl = makeProc();
`,
    );
    write(
      'consumer.ts',
      `import { SessionProcessor } from './processor';

const run = Effect.fn("App.run")(function* (msg: any) {
  const processors = yield* SessionProcessor.Service;
  const processor = yield* processors.create(msg);
  yield* processor.process(msg);
});

export { run };
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'App.run', 'SessionProcessor.create')).toBe(true);
    expect(hasCall(edges, 'App.run', 'SessionProcessor.process')).toBe(true);
  });

  it('leaves the standard variable-declarator path untouched', async () => {
    write(
      'plain.ts',
      `const double = (x: number) => x * 2;

function useIt(v: number) {
  return double(v);
}

export { useIt, double };
`,
    );
    const { edges } = await load();
    expect(hasCall(edges, 'useIt', 'double')).toBe(true);
  });
});
