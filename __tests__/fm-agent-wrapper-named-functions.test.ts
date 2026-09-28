/**
 * A function a string-named wrapper wraps gets a node, on both extraction
 * paths, including where nothing binds the wrapper's result.
 *
 * `Effect.fn("Session.run")(function* () {…})` is anonymous only syntactically.
 * Without a node the function is absent from the graph entirely — its own
 * callers have nothing to point at, and the calls in its body attribute to
 * whatever encloses it, so a file or an outer function picks up an outgoing
 * edge that belongs to it.
 *
 * Upstream closed most of this in #1747 (PR #2002): a wrapped function whose
 * result lands in a declarator or an object member is named after that
 * binding, which is the identifier its call sites use. This patch yields to
 * that wherever it applies and covers what it leaves: a wrapper passed as an
 * argument to another call, an array element, an arrow body, a return value.
 * Nothing names the function there except the wrapper's own string, so that
 * becomes its name and, with `.` read as `::`, its qualified name.
 *
 * Fork-only. The parity case is what catches the two extraction paths
 * drifting apart: the precedence exists once per path
 * (`src/extraction/tree-sitter.ts`, `codegraph-kernel/src/tsjs/`), and the
 * native one runs by default.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';
import { tryKernelExtract, resetKernelForTests } from '../src/extraction/kernel';
import type { ExtractionResult, Language } from '../src/types';

const KERNEL_PATH = path.join(
  __dirname,
  '..',
  'codegraph-kernel',
  'prebuilds',
  `${process.platform}-${process.arch}`,
  'codegraph-kernel.node',
);
const kernelBuilt = fs.existsSync(KERNEL_PATH);

// Every shape the patch covers, next to the two upstream covers, so one source
// pins the precedence as well as the coverage.
const SOURCE = `function lookup(id?: unknown) { return id; }

const layer = Effect.fn("SessionStatus.get")(function* (id: string) {
  return lookup(id);
});

function make() {
  return {
    getMode: Effect.fn("ACP.Session.getMode")(function* (id: string) { return lookup(id); }),
  };
}

export default Runtime.handler("api", Effect.fn("cli.api")(function* (input: unknown) {
  return lookup(input);
}));

register(Effect.fnUntraced('Session.run')((v: string) => lookup(v)));

const main = Effect.gen(function* () {
  const state = yield* InstanceState.make(Effect.fn("Agent.state")(function* () { return lookup(); }));
  return state;
});

const MIGRATIONS = [Effect.fn("Storage.migration.1")(function* () { return lookup(); })];

const generateWith = (stream: unknown) => Effect.fn("LLM.generate")(function* () { return lookup(stream); });

function normalizer() {
  return Effect.fn("Image.normalize")(function* () { return lookup(); });
}
`;

const ENV_KEYS = ['CODEGRAPH_KERNEL', 'CODEGRAPH_KERNEL_LANGS'] as const;
let savedEnv: Record<string, string | undefined>;

function canon(result: ExtractionResult) {
  return {
    nodes: result.nodes
      .map(({ updatedAt: _u, ...n }) => JSON.stringify(n, Object.keys(n).sort()))
      .sort(),
    edges: result.edges.map((e) => JSON.stringify(e, Object.keys(e).sort())).sort(),
    refs: result.unresolvedReferences
      .map((r) => JSON.stringify(r, Object.keys(r).sort()))
      .sort(),
  };
}

describe('string-named wrapper functions (fork patch)', () => {
  beforeAll(async () => {
    await initGrammars();
    await loadGrammarsForLanguages(['typescript']);
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    resetKernelForTests();
    process.env.CODEGRAPH_KERNEL = '0';
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetKernelForTests();
  });

  it('yields to the binding where the wrapper result lands in one', () => {
    const names = extractFromSource('wrapped.ts', SOURCE, 'typescript')
      .nodes.filter((n) => n.kind === 'function')
      .map((n) => n.name);
    // A declarator and an object member name the function (upstream, #1747);
    // the wrapper string does not replace either.
    expect(names).toContain('layer');
    expect(names).toContain('getMode');
    expect(names).not.toContain('SessionStatus.get');
    expect(names).not.toContain('ACP.Session.getMode');
  });

  it.each([
    ['an argument to another call', 'cli.api', 'cli::api'],
    ['an arrow through fnUntraced', 'Session.run', 'Session::run'],
    ['an initializer whose call result is bound', 'Agent.state', 'Agent::state'],
    ['an array element', 'Storage.migration.1', 'Storage::migration::1'],
    ['an arrow body', 'LLM.generate', 'LLM::generate'],
    ['a return value', 'Image.normalize', 'Image::normalize'],
  ])('names a wrapper bound to nothing after its string: %s', (_shape, name, qualifiedName) => {
    const result = extractFromSource('wrapped.ts', SOURCE, 'typescript');
    const fn = result.nodes.find((n) => n.kind === 'function' && n.name === name);
    expect(fn?.qualifiedName).toBe(qualifiedName);
    // The body's call belongs to the function, not to the file or the
    // enclosing function.
    expect(result.unresolvedReferences).toContainEqual(
      expect.objectContaining({ fromNodeId: fn?.id, referenceKind: 'calls', referenceName: 'lookup' }),
    );
  });

  it('leaves an ordinary callback anonymous, so the graph gains no node for it', () => {
    const result = extractFromSource('anonymous.ts', 'const values = items.map((i) => normalize(i));\n');
    expect(result.nodes.some((n) => n.kind === 'function')).toBe(false);
  });

  it.skipIf(!kernelBuilt)('reads the same on both extraction paths', () => {
    process.env.CODEGRAPH_KERNEL_LANGS = 'all';
    delete process.env.CODEGRAPH_KERNEL;
    const viaKernel = tryKernelExtract('wrapped.ts', SOURCE, 'typescript' as Language);
    expect(viaKernel, 'kernel extraction failed').not.toBeNull();

    process.env.CODEGRAPH_KERNEL = '0';
    const viaWasm = extractFromSource('wrapped.ts', SOURCE, 'typescript');

    const k = canon(viaKernel!);
    const w = canon(viaWasm);
    expect(k.nodes, 'nodes').toEqual(w.nodes);
    expect(k.edges, 'edges').toEqual(w.edges);
    expect(k.refs, 'refs').toEqual(w.refs);
  });
});
