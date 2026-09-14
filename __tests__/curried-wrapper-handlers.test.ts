/**
 * A function bound through a curried wrapper gets a node, named by the literal
 * the factory was handed or else by its declarator (#1747).
 *
 * `react_hook_bound_name` already names an anonymous function after the
 * `variable_declarator` that binds it, but only when the callee is one of three
 * React hooks. The same shape with any other wrapper produced no function node
 * at all — and the loss is not only a missing node: the body's calls attribute
 * to the enclosing container instead, so a file or an outer function picks up an
 * outgoing edge that belongs to the function, and the callee's caller list names
 * the wrong thing.
 *
 * The bound used here is that the callee is itself a call — a factory that
 * returns the wrapper. That admits `Effect.fn("x")(fn)`, `connect(m)(fn)` and a
 * project's own `wrap("n")(fn)`, and leaves the single-call forms whose argument
 * is a computation (`useMemo`, `arr.map`) anonymous exactly as before.
 *
 * Where the factory was handed a literal name it wins over the declarator: it is
 * the name the author qualified (`Effect.fn("Session.run")` says `run` of
 * `Session`, the declarator only says `run`), so it reads the way a stack trace
 * does and keeps two same-named handlers in different namespaces apart. A
 * factory with no literal name falls back to the declarator.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

const refsFrom = (result: ReturnType<typeof extractFromSource>, id: string) =>
  result.unresolvedReferences.filter((r) => r.fromNodeId === id).map((r) => r.referenceName);

const CODE = `
declare const Effect: { fn: (n: string) => (b: unknown) => unknown };
declare function connect(m: unknown): (c: unknown) => unknown;
declare function wrap(n: string): (c: unknown) => unknown;
declare function useMemo<T>(f: () => T, d: unknown[]): T;
declare const NAME: string;

function helper() { return 1; }

const viaEffectGen   = Effect.fn("Session.run")(function* () { return helper(); });
const viaEffectArrow = Effect.fn("Session.go")(() => { return helper(); });
const viaConnect     = connect({})(function () { return helper(); });
const viaWrapArrow   = wrap("Ns.wrapped")(() => { return helper(); });
const viaTemplate    = Effect.fn(\`Session.tmpl\`)(function* () { return 1; });
const viaComputed    = Effect.fn(\`Session.\${'x'}\`)(function* () { return 1; });
const viaVariable    = Effect.fn(NAME)(function* () { return 1; });

const total  = useMemo(() => 1 + 1, []);
const mapped = [1, 2].map(() => helper());
`;

describe('curried wrapper handlers', () => {
  it('names the wrapped function, for every callee shape', () => {
    const result = extractFromSource('src/b.ts', CODE);
    const names = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);

    // A generator is the common form in the ecosystem this comes from, and it
    // is the shape the report opens with — `function*` is not accepted by
    // reactHookBoundName, so broadening the callee test alone would not fix it.
    // Each of these carries a literal name, so that is the name.
    expect(names).toContain('Session.run');
    expect(names).toContain('Session.go');
    expect(names).toContain('Ns.wrapped');
    // `connect(mapState)` hands the factory no name, so the declarator is used.
    expect(names).toContain('viaConnect');
  });

  it('prefers the factory literal, and falls back to the declarator without one', () => {
    const result = extractFromSource('src/b.ts', CODE);
    const names = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);

    // A template literal with no substitution is the same name written the
    // other way round, so it counts.
    expect(names).toContain('Session.tmpl');
    // A substitution or a variable is a computation rather than a name; the
    // declarator stands in, and the function still gets its node.
    expect(names).toContain('viaComputed');
    expect(names).toContain('viaVariable');
    // The declarator name is not also minted when a literal supplied the name.
    expect(names).not.toContain('viaEffectGen');
  });

  it('leaves single-call arguments anonymous, so the graph does not gain nodes for computations', () => {
    const result = extractFromSource('src/b.ts', CODE);
    const names = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);

    // The guard that makes the bound meaningful. `useMemo(() => …, [])` and
    // `arr.map(() => …)` are single calls whose argument is a computation; if
    // these ever start producing function nodes, the callee test has been
    // widened past what this change claims.
    expect(names).not.toContain('total');
    expect(names).not.toContain('mapped');
  });

  it('attributes the body calls to the function, not to the file', () => {
    const result = extractFromSource('src/b.ts', CODE);
    const fn = result.nodes.find((n) => n.kind === 'function' && n.name === 'Session.run');
    expect(fn, 'no function node for Session.run').toBeDefined();

    // The half of the report that a node count alone does not cover: the file
    // must not be the one calling helper.
    expect(refsFrom(result, fn!.id)).toContain('helper');
    const file = result.nodes.find((n) => n.kind === 'file');
    expect(file, 'no file node').toBeDefined();
    expect(refsFrom(result, file!.id)).not.toContain('helper');
  });
});
