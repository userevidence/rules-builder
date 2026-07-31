import { describe, expect, test } from 'bun:test';
import type { FieldMap } from '@inixiative/json-rules';
import {
  emptyWorkspace,
  exportWorkspace,
  importWorkspace,
  narrowingAncestors,
  type Workspace,
} from '../examples/workspace';

const sampleMap: FieldMap = {
  models: { User: { fields: { tier: { kind: 'scalar', type: 'String' } } } },
};

const sample = (): Workspace => ({
  maps: { app: sampleMap },
  bridges: [],
  lenses: { 'app-users': { mapName: 'app', model: 'User' } },
  narrowings: {
    vip: {
      parent: { kind: 'lens', name: 'app-users' },
      narrowing: {
        root: {
          picks: ['tier'],
          sources: {
            tier: {
              all: [{ field: 'active', operator: 'equals', value: true }],
            },
          },
        },
      },
    },
  },
  rule: { all: [{ field: 'tier', operator: 'equals', value: 'g' }] },
  rules: {
    'g-tier': {
      source: { kind: 'lens', name: 'app-users' },
      rule: { all: [{ field: 'tier', operator: 'equals', value: 'g' }] },
    },
  },
  decorations: {},
  permissions: {
    'app:User': {
      actions: { read: { rule: { all: [{ field: 'tier', operator: 'equals', value: 'g' }] } } },
    },
  },
  transitions: {
    'app:User': {
      activate: {
        paths: [
          {
            from: { predicate: { all: [{ field: 'active', operator: 'equals', value: false }] } },
            to: { predicate: { all: [{ field: 'active', operator: 'equals', value: true }] } },
          },
        ],
      },
    },
  },
  maxDepth: 4,
});

describe('workspace', () => {
  test('emptyWorkspace has empty collections and an empty rule', () => {
    expect(emptyWorkspace()).toEqual({
      maps: {},
      bridges: [],
      lenses: {},
      narrowings: {},
      rule: { all: [] },
      rules: {},
      decorations: {},
      permissions: {},
      transitions: {},
      maxDepth: 4,
    });
  });

  test('export → import round-trips losslessly', () => {
    const ws = sample();
    expect(importWorkspace(exportWorkspace(ws))).toEqual(ws);
  });

  test('import fills defaults for missing keys', () => {
    const ws = importWorkspace(JSON.stringify({ maps: { app: sampleMap } }));
    expect(ws.bridges).toEqual([]);
    expect(ws.lenses).toEqual({});
    expect(ws.narrowings).toEqual({});
    expect(ws.rules).toEqual({});
    expect(ws.rule).toEqual({ all: [] });
  });

  test('import throws on malformed JSON', () => {
    expect(() => importWorkspace('{not json')).toThrow();
  });

  test('import throws when the root is not an object', () => {
    expect(() => importWorkspace('42')).toThrow();
    expect(() => importWorkspace('null')).toThrow();
  });

  test('import throws when a present key has the wrong type', () => {
    expect(() => importWorkspace(JSON.stringify({ bridges: 'nope' }))).toThrow(/bridges/);
  });
});

describe('narrowingAncestors (cycle guard for the parent picker)', () => {
  const ws = (): Workspace => ({
    ...emptyWorkspace(),
    lenses: { base: { mapName: 'app', model: 'User' } },
    narrowings: {
      a: { parent: { kind: 'lens', name: 'base' }, narrowing: {} },
      b: { parent: { kind: 'narrowing', name: 'a' }, narrowing: {} },
      c: { parent: { kind: 'narrowing', name: 'b' }, narrowing: {} },
    },
  });

  test('collects the full ancestor chain (not descendants)', () => {
    expect(narrowingAncestors(ws(), 'c')).toEqual(new Set(['b', 'a']));
    expect(narrowingAncestors(ws(), 'a')).toEqual(new Set());
  });

  test('a narrowing may parent only non-descendants — c is a descendant of a, so a can’t pick c', () => {
    const w = ws();
    // editing 'a': candidates whose ancestors include 'a' are descendants → excluded.
    const candidates = Object.keys(w.narrowings).filter(
      (n) => n !== 'a' && !narrowingAncestors(w, n).has('a'),
    );
    expect(candidates).toEqual([]); // b and c both descend from a
  });
});
