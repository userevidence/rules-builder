import { beforeEach, describe, expect, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { buildRoot, type GroupNode, type LeafNode } from '../src/builder/buildNodes';
import { describeModelFields, resolve } from '../src/schema/surface';

const map: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        age: { kind: 'scalar', type: 'Int' },
        metadata: { kind: 'scalar', type: 'Json' },
      },
    },
  },
};

const lens = resolve({ maps: { app: map }, mapName: 'app', model: 'User' });
const fields = describeModelFields(lens, 'app', 'User');

const cond = (): Condition => ({
  all: [{ field: 'tier', operator: 'equals', value: 'gold', _id: 'a' }],
});

let committed: Condition | undefined;
const build = (c: Condition) => {
  committed = undefined;
  return buildRoot(c, lens, fields, 4, (next) => {
    committed = next;
  });
};

describe('buildRoot — descriptor tree', () => {
  beforeEach(() => {
    committed = undefined;
  });

  test('root is a group with the operator and one leaf child', () => {
    const root = build(cond());
    expect(root.kind).toBe('group');
    expect(root.operator.value).toBe('all');
    expect(root.children).toHaveLength(1);
    expect(root.children[0].kind).toBe('leaf');
  });

  test('leaf exposes field / operator / value controls with options', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    expect(leaf.field.value).toBe('tier');
    expect(leaf.field.options.map((o) => o.value).sort()).toEqual(['age', 'metadata', 'tier']);
    expect(leaf.operator.value).toBe('equals');
    expect(leaf.operator.options.map((o) => o.value)).toContain('in');
    expect(leaf.value.current).toBe('gold');
    expect(leaf.value.shape).toBe('scalar');
    expect(leaf.value.options).toEqual([
      { value: 'gold', label: 'gold' },
      { value: 'silver', label: 'silver' },
    ]);
  });

  test('valid reflects the sourced/enum gate', () => {
    expect((build(cond()).children[0] as LeafNode).valid).toBe(true);
    const bad: Condition = {
      all: [{ field: 'tier', operator: 'equals', value: 'platinum', _id: 'a' }],
    };
    expect((build(bad).children[0] as LeafNode).valid).toBe(false);
  });

  test('value.set commits an updated tree', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    leaf.value.set('silver');
    expect(committed).toEqual({
      all: [{ field: 'tier', operator: 'equals', value: 'silver', _id: 'a' }],
    });
  });

  test('value.setMode switches a literal value to a path reference (value dropped)', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    expect(leaf.value.mode).toBe('value');
    expect(leaf.value.path).toBeUndefined();
    leaf.value.setMode('path');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(child.path).toBe('');
    expect('value' in child).toBe(false);
    expect(child.operator).toBe('equals'); // operator preserved
  });

  test('a path-mode leaf exposes path.value + path.set; setMode back restores a literal value', () => {
    const ref: Condition = { all: [{ field: 'tier', operator: 'equals', path: 'age', _id: 'a' }] };
    const leaf = build(ref).children[0] as LeafNode;
    expect(leaf.value.mode).toBe('path');
    expect(leaf.value.path?.value).toBe('age');
    leaf.value.path?.set('metadata');
    expect(((committed as { all: Condition[] }).all[0] as Record<string, unknown>).path).toBe(
      'metadata',
    );

    const leaf2 = build(ref).children[0] as LeafNode;
    leaf2.value.setMode('value');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect('path' in child).toBe(false);
    expect('value' in child).toBe(true);
  });

  test('value.setMode switches a literal value to a bind reference (value dropped)', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    expect(leaf.value.bind).toBeUndefined();
    leaf.value.setMode('bind');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(child.bind).toBe('');
    expect('value' in child).toBe(false);
    expect(child.operator).toBe('equals'); // operator preserved
  });

  test('a bind-mode leaf exposes bind.value + bind.set; setMode back restores a literal value', () => {
    const ref: Condition = {
      all: [{ field: 'tier', operator: 'equals', bind: 'currentTier', _id: 'a' }],
    };
    const leaf = build(ref).children[0] as LeafNode;
    expect(leaf.value.mode).toBe('bind');
    expect(leaf.value.bind?.value).toBe('currentTier');
    leaf.value.bind?.set('targetTier');
    expect(((committed as { all: Condition[] }).all[0] as Record<string, unknown>).bind).toBe(
      'targetTier',
    );

    const leaf2 = build(ref).children[0] as LeafNode;
    leaf2.value.setMode('value');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect('bind' in child).toBe(false);
    expect('value' in child).toBe(true);
  });

  test('field.set rebuilds the leaf for the new field', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    leaf.field.set('age');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(child.field).toBe('age');
    expect(child._id).toBe('a'); // keeps identity
  });

  test('remove commits the leaf removed', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    leaf.remove();
    expect(committed).toEqual({ all: [] });
  });

  test('group operator.set switches all/any', () => {
    build(cond()).operator.set('any');
    expect(committed).toHaveProperty('any');
  });

  test('addRule appends a child; addGroup appends an empty group; canAddGroup respects depth', () => {
    const root = build(cond());
    expect(root.canAddGroup).toBe(true);
    root.addRule();
    expect((committed as { all: Condition[] }).all).toHaveLength(2);

    const root2 = build(cond());
    root2.addGroup();
    const added = (committed as { all: Condition[] }).all.at(-1);
    expect(added).toEqual({ all: [] });
  });

  test('a Json field exposes acceptsSubPath + freeform subPath wiring', () => {
    expect(fields.find((f) => f.name === 'metadata')?.acceptsSubPath).toBe(true);

    const jsonCond: Condition = {
      all: [{ field: 'metadata.theme', operator: 'equals', value: 'dark', _id: 'm' }],
    };
    const leaf = build(jsonCond).children[0] as LeafNode;
    expect(leaf.field.value).toBe('metadata'); // base field selected
    expect(leaf.field.acceptsSubPath).toBe(true);
    expect(leaf.field.subPath).toBe('theme');

    leaf.field.setSubPath?.('mode');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(child.field).toBe('metadata.mode'); // recomposed, op/value preserved
    expect(child.value).toBe('dark');
  });

  test('a non-Json field has no sub-path affordance', () => {
    const leaf = build(cond()).children[0] as LeafNode;
    expect(leaf.field.acceptsSubPath).toBeFalsy();
    expect(leaf.field.setSubPath).toBeUndefined();
  });

  test('a bare field-rule root is NOT wrapped — it builds a field leaf', () => {
    const leafRoot: Condition = { field: 'tier', operator: 'equals', value: 'gold' };
    const root = build(leafRoot) as unknown as LeafNode;
    expect(root.kind).toBe('leaf');
    expect(root.leafKind).toBe('field');
    expect(root.field?.value).toBe('tier');
  });
});

describe('buildRoot — boolean leaves + bare root', () => {
  beforeEach(() => {
    committed = undefined;
  });

  test('a bare boolean root builds a true/false literal leaf, not a group', () => {
    const root = build(true) as unknown as LeafNode;
    expect(root.kind).toBe('leaf');
    expect(root.leafKind).toBe('boolean');
    expect(root.literal?.value).toBe(true);
  });

  test('toggling a boolean literal commits the opposite value', () => {
    const root = build(false) as unknown as LeafNode;
    root.literal?.set(true);
    expect(committed).toBe(true);
  });

  test('setLeafKind flips field ⇄ boolean (true on enter; a default field rule on exit)', () => {
    const fieldLeaf = build({
      field: 'tier',
      operator: 'equals',
      value: 'gold',
    }) as unknown as LeafNode;
    fieldLeaf.setLeafKind('boolean');
    expect(committed).toBe(true);

    const boolLeaf = build(true) as unknown as LeafNode;
    boolLeaf.setLeafKind('field');
    expect(committed).toMatchObject({ field: expect.any(String) });
  });

  test('a boolean inside a group renders as a literal-leaf child', () => {
    const c: Condition = {
      all: [true, { field: 'tier', operator: 'equals', value: 'gold', _id: 'a' }],
    };
    const root = build(c) as GroupNode;
    expect(root.kind).toBe('group');
    expect((root.children[0] as LeafNode).leafKind).toBe('boolean');
    expect((root.children[1] as LeafNode).leafKind).toBe('field');
  });

  test('deleting a group deletes its contents — never splices children up', () => {
    const c: Condition = {
      all: [
        { field: 'tier', operator: 'equals', value: 'gold' },
        { any: [{ field: 'age', operator: 'equals', value: 1 }] },
      ],
    };
    const root = build(c) as GroupNode;
    root.children[1].remove();
    expect(committed).toEqual({ all: [{ field: 'tier', operator: 'equals', value: 'gold' }] });
  });
});
