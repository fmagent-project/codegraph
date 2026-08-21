/**
 * A bare-name ref must not be fuzzy-matched onto one of SEVERAL same-named
 * METHODS (fork patch): method dispatch is decided by the receiver's type,
 * which a bare ref has lost, and directory proximity actively prefers a
 * same-module wrong candidate. Modeled on the case that motivated it: Rust's
 * `(*uptr).assume_init_mut().queue.init()` extracted as plain `init` in a
 * codebase with eight `init` methods resolved to the neighbor
 * `ProcessManager::init` instead of `StaticLinkedList::init`.
 */

import { describe, it, expect } from 'vitest';
import { matchReference } from '../src/resolution/name-matcher';
import type { UnresolvedRef, ResolutionContext } from '../src/resolution/types';
import { Node } from '../src/types';

function node(id: string, kind: Node['kind'], name: string, filePath: string): Node {
  return {
    id, kind, name,
    qualifiedName: `${filePath}::${name}`,
    filePath, language: 'rust',
    startLine: 1, endLine: 5, startColumn: 0, endColumn: 0,
    updatedAt: Date.now(),
  } as Node;
}

function contextFor(nodes: Node[]): ResolutionContext {
  return {
    getNodesInFile: (f: string) => nodes.filter((n) => n.filePath === f),
    getNodesByName: (name: string) => nodes.filter((n) => n.name === name),
    getAllNodes: () => nodes,
    getNodesByQualifiedName: (qn: string) => nodes.filter((n) => n.qualifiedName === qn),
    getNodesByLowerName: (name: string) =>
      nodes.filter((n) => n.name.toLowerCase() === name.toLowerCase()),
    readFile: () => null,
    getImportsForFile: () => [],
  } as unknown as ResolutionContext;
}

function bareCall(name: string, filePath: string): UnresolvedRef {
  return {
    id: 1, fromNodeId: 'fn:caller', referenceName: name, referenceKind: 'calls',
    filePath, line: 115, column: 8, language: 'rust',
  } as unknown as UnresolvedRef;
}

describe('bare-name refs onto ambiguous methods', () => {
  const methods = [
    node('m1', 'method', 'init', 'process_manager/impl_base.rs'),
    node('m2', 'method', 'init', 'slinkedlist/spec_impl_u.rs'),
    node('m3', 'method', 'init', 'memory_manager/root_table.rs'),
  ];

  it('default mode: still elects, but says it guessed (methodCandidates)', () => {
    delete process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION;
    const ref = bareCall('init', 'process_manager/endpoint_util_t.rs');
    const result = matchReference(ref, contextFor(methods));
    expect(result).not.toBeNull();
    expect(result!.methodCandidates).toBe(3);
  });

  it('strict mode declines instead of electing the same-directory neighbor', () => {
    process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION = '1';
    try {
      const ref = bareCall('init', 'process_manager/endpoint_util_t.rs');
      const result = matchReference(ref, contextFor(methods));
      expect(result).toBeNull();
    } finally {
      delete process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION;
    }
  });

  it('strict mode still resolves a UNIQUE method name', () => {
    process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION = '1';
    try {
      const one = [methods[0]!];
      const ref = bareCall('init', 'process_manager/endpoint_util_t.rs');
      const result = matchReference(ref, contextFor(one));
      expect(result).not.toBeNull();
      expect(result!.targetNodeId).toBe('m1');
      expect(result!.methodCandidates).toBeUndefined();
    } finally {
      delete process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION;
    }
  });

  it('strict mode still matches when candidates include a free function', () => {
    process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION = '1';
    try {
      const mixed = [...methods, node('f1', 'function', 'init', 'process_manager/util.rs')];
      const ref = bareCall('init', 'process_manager/endpoint_util_t.rs');
      const result = matchReference(ref, contextFor(mixed));
      expect(result).not.toBeNull();
    } finally {
      delete process.env.CODEGRAPH_STRICT_METHOD_RESOLUTION;
    }
  });
});
