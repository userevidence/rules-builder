import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode, LeafNode } from '../src/builder/buildNodes';
import { type UseRuleBuilderOptions, useRuleBuilder } from '../src/builder/useRuleBuilder';

afterEach(cleanup);

const map: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        age: { kind: 'scalar', type: 'Int' },
        orders: { kind: 'object', type: 'Order', isList: true },
      },
    },
    Order: { fields: { total: { kind: 'scalar', type: 'Float' } } },
  },
};
const source = { maps: { app: map }, mapName: 'app', model: 'User' };

const leafRule = (value = 'gold'): Condition => ({
  all: [{ field: 'tier', operator: 'equals', value }],
});

// Emitted rules are stamped with coerceType from the lens's field kinds.
const stampedLeafRule = (value = 'gold'): Condition => ({
  all: [{ field: 'tier', operator: 'equals', value, coerceType: 'String' }],
});

describe('useRuleBuilder — seed-once / defaultValue semantics', () => {
  test('seeds from defaultValue once and does NOT re-seed when the prop later changes', () => {
    const { result, rerender } = renderHook(
      (props: UseRuleBuilderOptions) => useRuleBuilder(props),
      {
        initialProps: { source, defaultValue: leafRule('gold') },
      },
    );
    expect(result.current.value).toEqual(stampedLeafRule('gold'));

    rerender({ source, defaultValue: leafRule('silver') });
    // Uncontrolled: the later defaultValue is ignored — still the mount seed.
    expect(result.current.value).toEqual(stampedLeafRule('gold'));
  });

  test('setCondition re-seeds the tree (and emits)', () => {
    const onChange = mock<(c: Condition) => void>();
    const { result } = renderHook(() =>
      useRuleBuilder({ source, defaultValue: leafRule('gold'), onChange }),
    );
    act(() =>
      result.current.setCondition({ all: [{ field: 'age', operator: 'equals', value: 5 }] }),
    );
    expect(result.current.value).toEqual({
      all: [{ field: 'age', operator: 'equals', value: 5, coerceType: 'Int' }],
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('absent defaultValue seeds the blank group; `empty` overrides the scaffold', () => {
    const blank = renderHook(() => useRuleBuilder({ source }));
    expect((blank.result.current.root as GroupNode).children).toEqual([]);

    const scaffold: Condition = {
      any: [{ all: [] }, { field: 'tier', operator: 'in', value: [] }],
    };
    const seeded = renderHook(() => useRuleBuilder({ source, empty: scaffold }));
    expect((seeded.result.current.root as GroupNode).children).toHaveLength(2);
  });

  test('defaultValue wins over `empty`; setCondition(undefined) reseeds to `empty`', () => {
    const scaffold: Condition = {
      any: [{ all: [] }, { field: 'tier', operator: 'in', value: [] }],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source, defaultValue: leafRule('gold'), empty: scaffold }),
    );
    expect(result.current.value).toEqual(stampedLeafRule('gold'));

    act(() => result.current.setCondition(undefined));
    expect((result.current.root as GroupNode).children).toHaveLength(2);
  });
});

describe('useRuleBuilder — onChange lifecycle', () => {
  test('is suppressed on first render, fires on an edit, and emits the cleaned value', () => {
    const onChange = mock<(c: Condition) => void>();
    const { result } = renderHook(() =>
      useRuleBuilder({ source, defaultValue: leafRule('gold'), onChange }),
    );
    expect(onChange).not.toHaveBeenCalled();

    const leaf = (result.current.root as GroupNode).children[0] as LeafNode;
    act(() => leaf.value?.set('silver'));

    expect(onChange).toHaveBeenCalledTimes(1);
    // cleaned: editor `_id`/`_groupId` meta stripped from the payload.
    expect(onChange.mock.calls[0][0]).toEqual(stampedLeafRule('silver'));
  });

  test('value is cleaned — empty groups trimmed, meta stripped', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source,
        defaultValue: { all: [{ field: 'tier', operator: 'equals', value: 'gold' }, { all: [] }] },
      }),
    );
    expect(result.current.value).toEqual(stampedLeafRule('gold'));
    expect(JSON.stringify(result.current.value)).not.toContain('_id');
    expect(JSON.stringify(result.current.value)).not.toContain('_groupId');
  });
});

describe('useRuleBuilder — coerceType stamping on emission', () => {
  test('array-nested conditions stamp against the related model', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source,
        defaultValue: {
          field: 'orders',
          arrayOperator: 'any',
          condition: { all: [{ field: 'total', operator: 'greaterThan', value: '10' }] },
        },
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test traversal
    const value = result.current.value as any;
    expect(value.condition.all[0].coerceType).toBe('Float');
  });

  test('a seeded coerceType is preserved, and the stamped rule validates', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source,
        defaultValue: {
          all: [{ field: 'age', operator: 'equals', value: '5', coerceType: 'String' }],
        },
      }),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test traversal
    expect((result.current.value as any).all[0].coerceType).toBe('String');
    expect(result.current.validate('check').ok).toBe(true);
  });
});

describe('useRuleBuilder — descriptor-tree actions through the hook', () => {
  test('addRule appends a child and the emitted value grows', () => {
    const onChange = mock<(c: Condition) => void>();
    const { result } = renderHook(() =>
      useRuleBuilder({ source, defaultValue: { all: [] }, onChange }),
    );
    const root = result.current.root as GroupNode;
    expect(root.canAddGroup).toBe(true);
    act(() => root.addRule());
    expect((result.current.value as { all: Condition[] }).all).toHaveLength(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('a bare boolean root builds a literal leaf; toggling it emits the opposite', () => {
    const onChange = mock<(c: Condition) => void>();
    const { result } = renderHook(() => useRuleBuilder({ source, defaultValue: true, onChange }));
    const root = result.current.root as unknown as LeafNode;
    expect(root.leafKind).toBe('boolean');
    expect(root.literal?.value).toBe(true);
    act(() => root.literal?.set(false));
    expect(result.current.value).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test('setLeafKind flips a field leaf to a boolean literal', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source,
        defaultValue: { field: 'tier', operator: 'equals', value: 'gold' },
      }),
    );
    const root = result.current.root as unknown as LeafNode;
    expect(root.leafKind).toBe('field');
    act(() => root.setLeafKind('boolean'));
    expect(result.current.value).toBe(true);
  });

  test('remove() on a bare ARRAY root clears to the empty group instead of crashing (regression)', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source, defaultValue: { field: 'orders', arrayOperator: 'notEmpty' } }),
    );
    const root = result.current.root as unknown as ArrayNode;
    expect(root.kind).toBe('array');
    expect(() => act(() => root.remove())).not.toThrow();
    expect(result.current.value).toEqual({ all: [] });
  });
});

describe('useRuleBuilder — memoization', () => {
  test('root is referentially stable across a no-op re-render (inputs unchanged)', () => {
    const props: UseRuleBuilderOptions = { source, defaultValue: leafRule('gold') };
    const { result, rerender } = renderHook((p: UseRuleBuilderOptions) => useRuleBuilder(p), {
      initialProps: props,
    });
    const first = result.current.root;
    rerender(props);
    expect(result.current.root).toBe(first);
    expect(result.current.lens).toBeDefined();
  });
});
