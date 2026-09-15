/**
 * A function a string-named wrapper names gets a node under that name.
 *
 * `Effect.fn("Session.run")(function* () {…})` is anonymous only syntactically:
 * the name is right there as the wrapper's first argument, and it is the one a
 * trace or a log shows. Without a node the function is absent from the graph
 * entirely — its own callers have nothing to point at, and the calls in its
 * body attribute to whatever encloses it, so a file or an outer function picks
 * up an outgoing edge that belongs to it.
 *
 * Fork-only, and paired with the resolution patch in
 * `fm-agent-effect-ts-resolution.test.ts`: the names minted here are qualified
 * (`Session.run`) while call sites are bare (`run()`), and that patch is what
 * closes the gap. Reported upstream as
 * https://github.com/colbymchenry/codegraph/issues/1747; PR #1814 there names
 * such a function after its declarator instead, which reaches neither a service
 * object returned from inside a function — the common Effect shape — nor the
 * qualification the wrapper string carries.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

describe('string-named wrapper functions (fork patch)', () => {
  it('names a generator passed through a string-named wrapper', () => {
    const result = extractFromSource(
      'wrapped.ts',
      'const layer = Effect.fn("SessionStatus.get")(function* (id: string) {\n' +
        '  return lookup(id);\n' +
        '});\n',
    );
    const fn = result.nodes.find((n) => n.kind === 'function' && n.name === 'SessionStatus.get');
    expect(fn).toBeDefined();
    expect(fn?.qualifiedName).toBe('SessionStatus::get');
    // The body's call belongs to the function, not to the file.
    expect(result.unresolvedReferences).toContainEqual(
      expect.objectContaining({ fromNodeId: fn?.id, referenceKind: 'calls', referenceName: 'lookup' }),
    );
  });

  it('names an arrow passed through fnUntraced', () => {
    const result = extractFromSource(
      'wrapped-arrow.ts',
      "const run = Effect.fnUntraced('Session.run')((v: string) => helper(v));\n",
    );
    const fn = result.nodes.find((n) => n.kind === 'function' && n.name === 'Session.run');
    expect(fn?.qualifiedName).toBe('Session::run');
    expect(result.unresolvedReferences).toContainEqual(
      expect.objectContaining({ fromNodeId: fn?.id, referenceName: 'helper' }),
    );
  });

  it('reaches a service object returned from inside a function', () => {
    // The shape the `const` binding alone does not cover, and the one an Effect
    // codebase is mostly written in.
    const result = extractFromSource(
      'service.ts',
      'function make() {\n' +
        '  return {\n' +
        '    getMode: Effect.fn("ACP.Session.getMode")(function* (id) { return lookup(id); }),\n' +
        '  };\n' +
        '}\n',
    );
    const names = result.nodes.filter((n) => n.kind === 'function').map((n) => n.name);
    expect(names).toContain('ACP.Session.getMode');
  });

  it('leaves an ordinary callback anonymous, so the graph gains no node for it', () => {
    const result = extractFromSource('anonymous.ts', 'const values = items.map((i) => normalize(i));\n');
    expect(result.nodes.some((n) => n.kind === 'function')).toBe(false);
  });
});
