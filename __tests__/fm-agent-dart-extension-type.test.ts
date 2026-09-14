/**
 * A Dart 3.3 extension type is a type, and its members are its methods.
 *
 * `extension_type_declaration` was listed in neither extraction path's class
 * types — `extension_declaration`, the older `extension`, was, and the two names
 * are near neighbours. So the wasm walker never entered the body: its getters
 * got no node, and the member that followed had its span cut short at the
 * signature line. The kernel reached the members through its own fallback but
 * minted them as top-level functions with no type to belong to.
 *
 * The two paths therefore disagreed, which `kernel-dart-parity.test.ts` catches
 * — but only where something runs it. Upstream has no CI workflow; this fork's
 * `ci.yml` is what surfaced it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

const SRC = [
  'extension type Meters(double value) {',
  '  double get km => value / 1000;',
  '  void report() {',
  '    print(km);',
  '  }',
  '}',
  '',
  'class Plain {',
  '  double get half => 1.0;',
  '}',
  '',
].join('\n');

describe('Dart extension type', () => {
  it('is a type of its own, with its members as methods', () => {
    const result = extractFromSource('lib/a.dart', SRC);
    const meters = result.nodes.find((n) => n.name === 'Meters');
    expect(meters?.kind).toBe('class');

    const km = result.nodes.find((n) => n.name === 'km');
    expect(km, 'the getter must have a node').toBeDefined();
    expect(km?.kind).toBe('method');
  });

  it('does not cut short the span of the member after a getter', () => {
    const result = extractFromSource('lib/a.dart', SRC);
    const report = result.nodes.find((n) => n.name === 'report');
    // The body runs to its closing brace, not to the signature line.
    expect(report?.endLine).toBeGreaterThan(report!.startLine);
  });

  it('leaves an ordinary class as it was', () => {
    const result = extractFromSource('lib/a.dart', SRC);
    const half = result.nodes.find((n) => n.name === 'half');
    expect(half?.kind).toBe('method');
    expect(result.nodes.find((n) => n.name === 'Plain')?.kind).toBe('class');
  });
});
