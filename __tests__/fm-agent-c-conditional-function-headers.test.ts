import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import CodeGraph from '../src/index';
import { initGrammars, loadGrammarsForLanguages } from '../src/extraction/grammars';
import { extractFromSource } from '../src/extraction';
import { resetKernelForTests, tryKernelExtract } from '../src/extraction/kernel';
import { blankCAlternativeFunctionHeaders } from '../src/extraction/languages/c-cpp';
import type { ExtractionResult } from '../src/types';

const kernelAvailable = fs.existsSync(path.join(__dirname, '..', 'codegraph-kernel', 'prebuilds',
  `${process.platform}-${process.arch}`, 'codegraph-kernel.node')) || process.env.CODEGRAPH_KERNEL_EXPECT === '1';
const envKeys = ['CODEGRAPH_KERNEL', 'CODEGRAPH_KERNEL_LANGS', 'CODEGRAPH_KERNEL_CCPP_ERROR_EXTRACT'] as const;

describe('C conditional function headers and recovered control statements', () => {
  let savedEnv: Record<string, string | undefined>;
  beforeAll(async () => {
    await initGrammars();
    await loadGrammarsForLanguages(['c']);
  });
  beforeEach(() => {
    savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
    resetKernelForTests();
  });
  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetKernelForTests();
  });

  function extract(backend: 'wasm' | 'kernel', source: string): ExtractionResult {
    if (backend === 'wasm') {
      process.env.CODEGRAPH_KERNEL = '0';
      return extractFromSource('qp.c', source, 'c');
    }
    delete process.env.CODEGRAPH_KERNEL;
    process.env.CODEGRAPH_KERNEL_LANGS = 'all';
    process.env.CODEGRAPH_KERNEL_CCPP_ERROR_EXTRACT = '1';
    const result = tryKernelExtract('qp.c', source, 'c');
    expect(result).not.toBeNull();
    return result!;
  }

  function expectCall(result: ExtractionResult, caller: string, callee: string) {
    const owner = result.nodes.find(n => n.kind === 'function' && n.name === caller)!;
    expect(owner).toBeDefined();
    expect(result.unresolvedReferences.some(ref => ref.fromNodeId === owner.id
      && ref.referenceKind === 'calls' && ref.referenceName === callee)).toBe(true);
  }

  const backends = kernelAvailable ? ['wasm', 'kernel'] as const : ['wasm'] as const;
  for (const crlf of [false, true]) {
    const eol = (text: string) => crlf ? text.replace(/\n/g, '\r\n') : text;
    const label = crlf ? 'CRLF' : 'LF';

    it.each(backends)(`extracts shared bodies once, with original locations and calls (${label}, %s)`, backend => {
      const source = eol(`#ifndef Q_SPY
bool QActive_post_(QActive * const me, QEvt const * const e,
                   uint_fast16_t const margin)
#else
bool QActive_post_(QActive * const me, QEvt const * const e,
                   uint_fast16_t const margin, void const * const sender)
#endif
{
    QF_CRIT_STAT_
    Q_REQUIRE_ID(100, e != (QEvt const *)0);
    deliver(e);
    return true;
}
void after(void) { QActive_post_(0, 0, 0); }
`);
      const result = extract(backend, source);
      expect(result.nodes.filter(n => n.kind === 'function').map(n => n.name))
        .toEqual(['QActive_post_', 'after']);
      const post = result.nodes.find(n => n.name === 'QActive_post_')!;
      expect([post.startLine, post.endLine]).toEqual([2, 13]);
      expectCall(result, 'QActive_post_', 'deliver');
      expectCall(result, 'QActive_post_', 'Q_REQUIRE_ID');
      expectCall(result, 'after', 'QActive_post_');
      const normalized = blankCAlternativeFunctionHeaders(source);
      expect(normalized.length).toBe(source.length);
      expect([...normalized.matchAll(/[\r\n]/g)].map(m => m.index))
        .toEqual([...source.matchAll(/[\r\n]/g)].map(m => m.index));
      expect(normalized.indexOf('deliver')).toBe(source.indexOf('deliver'));
    });

    it.each(backends)(`keeps conditional else-if calls in the real caller (${label}, %s)`, backend => {
      const result = extract(backend, eol(`void dispatch(int r) {
    if (r == 0) { first(); }
#ifdef Q_SPY
    /* tracing-only branches */
    else if (r == 1) {
        handled();
    }
    else if (r == 2) {
        ignored();
    }
#endif
    else { last(); }
    after();
}
void Q_REQUIRE_ID(int id) { legitimate(); }
`));
      expect(result.nodes.filter(n => n.kind === 'function').map(n => n.name))
        .toEqual(['dispatch', 'Q_REQUIRE_ID']);
      for (const callee of ['first', 'handled', 'ignored', 'last', 'after']) {
        expectCall(result, 'dispatch', callee);
      }
      expectCall(result, 'Q_REQUIRE_ID', 'legitimate');
    });

    it.each(backends)(`supports elif and function-pointer parameters (${label}, %s)`, backend => {
      const result = extract(backend, eol(`#if SMALL
static char *pick(void (*cb)(int))
#elif MEDIUM
static char *pick(void (*cb)(int), int count)
#else
static char *pick(void (*cb)(int), int count, void *sender)
#endif
/* common body */
{ return lookup(); }
`));
      expect(result.nodes.filter(n => n.kind === 'function').map(n => n.name)).toEqual(['pick']);
      expectCall(result, 'pick', 'lookup');
    });
  }

  it.each(backends)('resolves calls to recovered functions in an indexed project (%s)', async backend => {
    if (backend === 'wasm') process.env.CODEGRAPH_KERNEL = '0';
    else {
      delete process.env.CODEGRAPH_KERNEL;
      process.env.CODEGRAPH_KERNEL_LANGS = 'all';
      process.env.CODEGRAPH_KERNEL_CCPP_ERROR_EXTRACT = '1';
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-c-conditional-'));
    let cg: CodeGraph | undefined;
    try {
      fs.writeFileSync(path.join(root, 'post.c'), `#ifndef Q_SPY
int post(int x)
#else
int post(int x, void *sender)
#endif
{
    if (x == 0) { first(); }
#ifdef Q_SPY
    else if (x == 1) { handled(); }
#endif
    return x;
}
`);
      fs.writeFileSync(path.join(root, 'app.c'), `void first(void) {}
void handled(void) {}
void app(void) { post(0); }
`);
      cg = await CodeGraph.init(root, { index: true, silent: true });
      const nodes = [...cg.getNodesInFile('post.c'), ...cg.getNodesInFile('app.c')];
      const byId = new Map(nodes.map(n => [n.id, n.name]));
      const calls = cg.getOutgoingEdgesFrom(nodes.map(n => n.id)).filter(e => e.kind === 'calls')
        .map(e => `${byId.get(e.source)} -> ${byId.get(e.target)}`);
      expect(nodes.filter(n => n.kind === 'function').map(n => n.name).sort())
        .toEqual(['app', 'first', 'handled', 'post']);
      expect(calls.sort()).toEqual(['app -> post', 'post -> first', 'post -> handled']);
    } finally {
      cg?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    '#if A\nvoid f(void) {}\n#else\nvoid f(int x) {}\n#endif\n',
    '#if A\nvoid f(void)\n#else\nvoid g(void)\n#endif\n{}\n',
    '#if A\nvoid f(void)\n#endif\n{}\n',
    '#if A\nvoid f(\n#else\nvoid f(int x\n#endif\n) {}\n',
    '#if A\n#if B\nvoid f(void)\n#endif\n#else\nvoid f(int x)\n#endif\n{}\n',
    '#if A\n#define TYPE int\nTYPE f(void)\n#else\nint f(int x)\n#endif\n{}\n',
    '/*\n#if A\nvoid f(void)\n#else\nvoid f(int x)\n#endif\n{}\n*/\n',
    '#define HEADERS \\\n#if A \\\nvoid f(void) \\\n#else \\\nvoid f(int x) \\\n#endif\n{}\n',
  ])('leaves unrelated or ambiguous conditionals unchanged: %s', source => {
    expect(blankCAlternativeFunctionHeaders(source)).toBe(source);
  });
});
