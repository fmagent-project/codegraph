/**
 * A class field holding a generator function is a method, on both extraction
 * paths.
 *
 * `class Repo { loadAll = function* () {…} }` is a method written as a field.
 * Two helpers decide that — one classifies the field, the other finds the body
 * to walk — and both list the node types a field's value may have. Leave
 * `generator_function` off those lists and the field is a property: no callable
 * node, and the calls in its body attribute to the file instead of to it.
 *
 * The lists exist twice, once per extraction path (`src/extraction/languages/`
 * for the wasm walker, `codegraph-kernel/src/tsjs/mod.rs` for the native one,
 * which runs by default). They must be changed together: with only one side
 * updated the same source yields a method on one path and a property on the
 * other, and which one a project gets depends on whether a kernel binary is
 * staged. The parity cases below are what catches that.
 *
 * Fork-only. Upstream indexes generators themselves
 * (https://github.com/colbymchenry/codegraph/issues/1741), but its fix did not
 * reach these two field helpers.
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

const TS_SOURCE = `export class Repo {
  loadAll = function* () {
    return fetchRows();
  };
  throttled = throttle(function* () {
    return fetchRows();
  }, 100);
  plain = function () {
    return fetchRows();
  };
}
function fetchRows() { return []; }
function throttle(f: unknown, ms: number) { return f; }
`;

const JS_SOURCE = TS_SOURCE.replace('f: unknown, ms: number', 'f, ms');

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

describe('generator functions held in a class field (fork patch)', () => {
  beforeAll(async () => {
    await initGrammars();
    await loadGrammarsForLanguages(['typescript', 'javascript']);
  });

  beforeEach(() => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    resetKernelForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetKernelForTests();
  });

  it.each([
    ['gen-field.ts', TS_SOURCE, 'typescript'],
    ['gen-field.js', JS_SOURCE, 'javascript'],
  ] as const)('indexes the field as a method owning its body: %s', (file, source, language) => {
    process.env.CODEGRAPH_KERNEL = '0';
    const result = extractFromSource(file, source, language);

    const loadAll = result.nodes.find((n) => n.name === 'loadAll');
    expect(loadAll?.kind).toBe('method');
    expect(loadAll?.qualifiedName).toBe('Repo::loadAll');

    // Through a higher-order wrapper too — the same two helpers look inside the
    // call's arguments.
    expect(result.nodes.find((n) => n.name === 'throttled')?.kind).toBe('method');

    // The body's call belongs to the field, not to the enclosing file: this is
    // what a property classification loses.
    const callers = result.unresolvedReferences
      .filter((r) => r.referenceKind === 'calls' && r.referenceName === 'fetchRows')
      .map((r) => result.nodes.find((n) => n.id === r.fromNodeId)?.qualifiedName)
      .sort();
    expect(callers).toEqual(['Repo::loadAll', 'Repo::plain', 'Repo::throttled']);
  });

  it.skipIf(!kernelBuilt).each([
    ['gen-field.ts', TS_SOURCE, 'typescript'],
    ['gen-field.js', JS_SOURCE, 'javascript'],
  ] as const)('reads the same on both extraction paths: %s', (file, source, language) => {
    process.env.CODEGRAPH_KERNEL_LANGS = 'all';
    delete process.env.CODEGRAPH_KERNEL;
    const viaKernel = tryKernelExtract(file, source, language as Language);
    expect(viaKernel, `kernel extraction failed for ${file}`).not.toBeNull();

    process.env.CODEGRAPH_KERNEL = '0';
    const viaWasm = extractFromSource(file, source, language);
    delete process.env.CODEGRAPH_KERNEL;

    const k = canon(viaKernel!);
    const w = canon(viaWasm);
    expect(k.nodes, `${file}: nodes`).toEqual(w.nodes);
    expect(k.edges, `${file}: edges`).toEqual(w.edges);
    expect(k.refs, `${file}: refs`).toEqual(w.refs);
  });
});
