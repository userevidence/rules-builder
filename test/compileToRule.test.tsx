import { afterEach, describe, expect, test } from 'bun:test';
import { type Condition, check, checkRuleAgainstLens, type FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode, LeafNode } from '../src/builder/buildNodes';
import { useRuleBuilder } from '../src/builder/useRuleBuilder';
import type { Decoration } from '../src/schema/decoration';

afterEach(cleanup);

const rootGroup = (r: { root: unknown }) => r.root as GroupNode;
const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };

const map: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String' },
        account: { kind: 'object', type: 'Account' },
        customFields: { kind: 'object', type: 'CustomField', isList: true },
      },
    },
    Account: { fields: { industry: { kind: 'scalar', type: 'String' } } },
    CustomField: {
      fields: {
        key: { kind: 'scalar', type: 'String' },
        value: { kind: 'scalar', type: 'String' },
      },
    },
  },
};
const source = { maps: { app: map }, mapName: 'app', model: 'User' };

describe('a decoration facet compiles to a rule that passes the lens gate and evaluates', () => {
  test('leaf facet — a relation-crossing dotted path', () => {
    const decoration: Decoration = { facets: [{ path: 'account.industry', label: 'Industry' }] };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration, defaultValue: seed }));

    const row = rootGroup(result.current).children[0] as LeafNode;
    const opt = row.field?.options.find((o) => o.label === 'Industry');
    if (!opt) throw new Error('Industry not offered');
    act(() => row.field?.set(opt.value));
    let leaf = rootGroup(result.current).children[0] as LeafNode;
    act(() => leaf.operator?.set('equals'));
    leaf = rootGroup(result.current).children[0] as LeafNode;
    act(() => leaf.value?.set('tech'));

    const emitted = result.current.value;
    expect(checkRuleAgainstLens(emitted, result.current.lens).ok).toBe(true);
    expect(check(emitted, { account: { industry: 'tech' } })).toBe(true);
    expect(check(emitted, { account: { industry: 'saas' } })).not.toBe(true);
  });

  test('sliced collection facet — the EAV "NPS" case', () => {
    const decoration: Decoration = {
      facets: [
        {
          path: 'customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          kind: 'Int',
          label: 'NPS',
        },
      ],
    };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration, defaultValue: seed }));

    const row = rootGroup(result.current).children[0] as LeafNode;
    const opt = row.field?.options.find((o) => o.label === 'NPS');
    if (!opt) throw new Error('NPS not offered');
    act(() => row.field?.set(opt.value));

    // the array node's condition IS the user-rows group — the identity is out of view.
    let arr = rootGroup(result.current).children[0] as ArrayNode;
    let value = arr.condition?.children[0] as LeafNode;
    act(() => value.operator?.set('greaterThan'));
    arr = rootGroup(result.current).children[0] as ArrayNode;
    value = arr.condition?.children[0] as LeafNode;
    act(() => value.value?.set(5));

    const emitted = result.current.value;
    expect(checkRuleAgainstLens(emitted, result.current.lens).ok).toBe(true);
    expect(check(emitted, { customFields: [{ key: 'nps', value: 9 }] })).toBe(true);
    expect(check(emitted, { customFields: [{ key: 'nps', value: 1 }] })).not.toBe(true);
    // the locked where actually scopes it: a non-nps element does not satisfy it.
    expect(check(emitted, { customFields: [{ key: 'csat', value: 9 }] })).not.toBe(true);
  });

  test('preset facet — a named alias for a complete pre-authored condition', () => {
    const mature: Condition = {
      all: [
        { field: 'tier', operator: 'equals', value: 'gold' },
        { field: 'account.industry', operator: 'equals', value: 'tech' },
      ],
    };
    const decoration: Decoration = { facets: [{ label: 'Mature', condition: mature }] };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration, defaultValue: seed }));

    const row = rootGroup(result.current).children[0] as LeafNode;
    const opt = row.field?.options.find((o) => o.label === 'Mature');
    if (!opt) throw new Error('Mature not offered');
    act(() => row.field?.set(opt.value));

    // the whole condition dropped in as one atomic node — a renderer shows just the name.
    const group = rootGroup(result.current).children[0] as GroupNode;
    expect(group.atomic).toBe(true);
    expect(group.hoist?.label).toBe('Mature');

    const emitted = result.current.value;
    expect(checkRuleAgainstLens(emitted, result.current.lens).ok).toBe(true);
    expect(check(emitted, { tier: 'gold', account: { industry: 'tech' } })).toBe(true);
    expect(check(emitted, { tier: 'silver', account: { industry: 'tech' } })).not.toBe(true);

    // and a saved rule equal to the preset rehydrates as the atomic "Mature" node.
    const reopened = renderHook(() => useRuleBuilder({ source, decoration, defaultValue: mature }));
    const root = reopened.result.current.root as GroupNode;
    expect(root.atomic).toBe(true);
    expect(root.hoist?.label).toBe('Mature');
  });

  test('branch facet — a scoped group over the related model', () => {
    const decoration: Decoration = { facets: [{ path: 'account', label: 'Company' }] };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration, defaultValue: seed }));

    const row = rootGroup(result.current).children[0] as LeafNode;
    const opt = row.field?.options.find((o) => o.label === 'Company');
    if (!opt) throw new Error('Company not offered');
    act(() => row.field?.set(opt.value));

    const group = rootGroup(result.current).children[0] as GroupNode;
    const inner = group.children[0] as LeafNode;
    act(() => inner.value?.set('tech'));

    const emitted = result.current.value;
    expect(checkRuleAgainstLens(emitted, result.current.lens).ok).toBe(true);
    expect(check(emitted, { account: { industry: 'tech' } })).toBe(true);
    expect(check(emitted, { account: { industry: 'saas' } })).not.toBe(true);
  });
});
