import { afterEach, describe, expect, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode, LeafNode } from '../src/builder/buildNodes';
import { useRuleBuilder } from '../src/builder/useRuleBuilder';
import type { Decoration } from '../src/schema/decoration';

afterEach(cleanup);

// A facet's fixed `where` is the node's identity: it must stay AND-ed no matter what
// the group's ALL/ANY toggle says. Flipping the whole group to `any` used to OR the
// identity clause into the user's rows — the rule silently changed meaning ("answered
// THE question with one of these values" became "answered that question at all, OR
// gave any of these answers") and the facet stopped matching, unlocking the identity
// row for editing. The toggle now writes `{ all: [...where, { any: [...rows] }] }`.

const eavMap: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        customFields: { kind: 'object', type: 'CustomField', isList: true },
      },
    },
    CustomField: {
      fields: {
        key: { kind: 'scalar', type: 'String' },
        value: { kind: 'scalar', type: 'String' },
      },
    },
  },
};
const eavSource = { maps: { app: eavMap }, mapName: 'app', model: 'User' };
const npsView: Decoration = {
  facets: [
    {
      path: 'customFields.value',
      where: { field: 'key', operator: 'equals', value: 'nps' },
      label: 'NPS',
    },
  ],
};

const rootGroup = (r: { root: unknown }) => r.root as GroupNode;
const where = { field: 'key', operator: 'equals', value: 'nps' };
const savedFacet = (rows: Condition[]): Condition => ({
  all: [
    {
      field: 'customFields',
      arrayOperator: 'any',
      condition: { all: [where as Condition, ...rows] },
    } as Condition,
  ],
});
const row = (value: string): Condition =>
  ({ field: 'value', operator: 'equals', value }) as Condition;

const facetNode = (r: { root: unknown }) => rootGroup(r).children[0] as ArrayNode;
const savedNode = (r: { value: unknown }) =>
  (r.value as { all: Condition[] }).all[0] as {
    condition: { all?: Condition[]; any?: Condition[] };
  };

describe('collection facet — ALL/ANY toggle keeps the fixed where AND-ed', () => {
  test('toggling ANY nests the user rows; the identity clause stays a leading AND', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9'), row('10')]),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(where),
        { any: [expect.objectContaining(row('9')), expect.objectContaining(row('10'))] },
      ],
    });
  });

  test('the nested-any state still matches the facet and keeps the where locked', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('NPS');
    // The identity is not part of the view — the rows group is the whole surface.
    expect(node.condition?.children).toHaveLength(1);
  });

  test('the rows group is the surface: operator "any", user rows as its children', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9'), row('10')]),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    const group = facetNode(result.current).condition;
    expect(group?.operator.value).toBe('any');
    // Only the user's rows — the identity clause is not in the view at all.
    expect(group?.children).toHaveLength(2);
    expect(group?.children.every((c) => c.kind === 'leaf')).toBe(true);
    expect((group?.children[0] as LeafNode).value?.current).toBe('9');
  });

  test('addRule in the ANY state lands inside the nested group, not next to the where', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    act(() => facetNode(result.current).condition?.addRule());
    const condition = savedNode(result.current).condition;
    expect(condition.all).toHaveLength(2);
    expect((condition.all?.[1] as { any: Condition[] }).any).toHaveLength(2);
  });

  test('a group error annotation survives the toggle round-trip', () => {
    // The locked-view rewrite must preserve everything non-structural, exactly as
    // switchGroupOperator does on an ordinary group.
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: {
          all: [
            {
              field: 'customFields',
              arrayOperator: 'any',
              condition: { all: [where as Condition, row('9')], error: 'pick a score' },
            } as Condition,
          ],
        },
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toMatchObject({ error: 'pick a score' });
    act(() => facetNode(result.current).condition?.operator.set('all'));
    expect(savedNode(result.current).condition).toMatchObject({ error: 'pick a score' });
  });

  test('toggling back to ALL keeps the canonical shape: identity + rows group', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9'), row('10')]),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    act(() => facetNode(result.current).condition?.operator.set('all'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(where),
        { all: [expect.objectContaining(row('9')), expect.objectContaining(row('10'))] },
      ],
    });
    expect(facetNode(result.current).hoist?.label).toBe('NPS');
  });
});

describe('collection facet — value options stay pinned inside the nested any group', () => {
  // The where clauses pin a grouped field's option set to its partition (source ›
  // field). They sit one level ABOVE the nested any group, but they are conjoined
  // with every disjunct — the pin must survive the toggle, or the value dropdown
  // falls back to the whole brand vocabulary.
  const pinnedMap: FieldMap = {
    models: {
      User: {
        fields: {
          customFields: { kind: 'object', type: 'CustomField', isList: true },
        },
      },
      CustomField: {
        fields: {
          key: { kind: 'scalar', type: 'String' },
          value: {
            kind: 'scalar',
            type: 'String',
            groupBy: ['key'],
            options: [
              { value: 'Green', groups: ['health'] },
              { value: 'Red', groups: ['health'] },
              { value: 'Healthcare', groups: ['industry'] },
            ],
          },
        },
      },
    },
  };
  const pinnedSource = { maps: { app: pinnedMap }, mapName: 'app', model: 'User' };
  const healthView: Decoration = {
    facets: [
      {
        path: 'customFields.value',
        where: { field: 'key', operator: 'equals', value: 'health' },
        label: 'Health',
      },
    ],
  };
  const healthWhere = { field: 'key', operator: 'equals', value: 'health' };
  const saved: Condition = {
    all: [
      {
        field: 'customFields',
        arrayOperator: 'any',
        condition: {
          all: [healthWhere as Condition, { field: 'value', operator: 'equals', value: 'Green' }],
        },
      } as Condition,
    ],
  };

  test('after the ANY toggle a value row still offers only the facet partition', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source: pinnedSource, decoration: healthView, defaultValue: saved }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    const valueRow = facetNode(result.current).condition?.children[0] as LeafNode;
    expect(valueRow.value?.options?.map((o) => o.value)).toEqual(['Green', 'Red']);
    expect(valueRow.valid).toBe(true);
  });
});

describe('whereless collection facet — ANY toggle must not break recognition', () => {
  const valuesView: Decoration = {
    facets: [{ path: 'customFields.value', label: 'Values' }],
  };

  test('a saved any-group element rule still matches its whereless facet', () => {
    // No identity clause to protect, so the wholesale flip is fine — but the facet
    // match used to read only `condition.all` and lost the node entirely.
    const defaultValue: Condition = {
      all: [
        {
          field: 'customFields',
          arrayOperator: 'any',
          condition: { any: [row('a'), row('b')] },
        } as Condition,
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: valuesView, defaultValue }),
    );
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('Values');
  });
});

describe('a live lookalike (non-canonical match) renders honestly raw', () => {
  test('badge without hiding: every row visible, and the toggle breaks the bind', () => {
    // Author a flat lookalike mid-session (ingest never saw it as a facet, so
    // nothing was normalized): the badge appears, but the identity row stays a
    // visible, editable child. Toggling the group is then an honest, visible
    // edit — recognition drops instead of a hidden clause being absorbed.
    const notYet: Condition = {
      all: [
        {
          field: 'customFields',
          arrayOperator: 'any',
          condition: { all: [{ field: 'key', operator: 'equals', value: 'other' }, row('9')] },
        } as Condition,
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue: notYet }),
    );
    expect(facetNode(result.current).hoist).toBeUndefined();
    act(() => {
      const keyRow = facetNode(result.current).condition?.children[0] as LeafNode;
      keyRow.value?.set('nps');
    });
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('NPS');
    // Non-canonical: nothing is hidden — both rows render, identity included.
    expect(node.condition?.children).toHaveLength(2);
    act(() => facetNode(result.current).condition?.operator.set('any'));
    // The toggle visibly changed the rule the user was looking at — bind breaks.
    expect(facetNode(result.current).hoist).toBeUndefined();
    expect((result.current.value as { all: Condition[] }).all[0]).toMatchObject({
      condition: { any: [expect.objectContaining(where), expect.objectContaining(row('9'))] },
    });
  });
});

describe('branch facet — ALL/ANY toggle keeps the fixed where AND-ed', () => {
  const branchMap: FieldMap = {
    models: {
      User: {
        fields: {
          tier: { kind: 'scalar', type: 'String' },
          account: { kind: 'object', type: 'Account' },
        },
      },
      Account: {
        fields: {
          industry: { kind: 'scalar', type: 'String' },
          arr: { kind: 'scalar', type: 'Int' },
        },
      },
    },
  };
  const branchSource = { maps: { app: branchMap }, mapName: 'app', model: 'User' };
  const branchWhere = { field: 'account.industry', operator: 'equals', value: 'saas' };
  const decoration: Decoration = {
    facets: [{ path: 'account', label: 'SaaS Company', where: branchWhere as Condition }],
  };
  const defaultValue: Condition = {
    all: [
      {
        all: [
          branchWhere as Condition,
          { field: 'account.arr', operator: 'greaterThan', value: 100 } as Condition,
          { field: 'account.arr', operator: 'lessThan', value: 900 } as Condition,
        ],
      },
    ],
  };

  test('toggling ANY nests the user rows; identity stays AND-ed and the facet holds', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration, defaultValue }),
    );
    const group = rootGroup(result.current).children[0] as GroupNode;
    expect(group.hoist?.label).toBe('SaaS Company');
    // Ingest normalized to canonical: the rows group is the surface (2 rows).
    expect(group.children).toHaveLength(2);
    act(() => group.operator.set('any'));
    expect((result.current.value as { all: Condition[] }).all[0]).toEqual({
      all: [
        expect.objectContaining(branchWhere),
        {
          any: [
            expect.objectContaining({ field: 'account.arr', operator: 'greaterThan' }),
            expect.objectContaining({ field: 'account.arr', operator: 'lessThan' }),
          ],
        },
      ],
    });
    const after = rootGroup(result.current).children[0] as GroupNode;
    expect(after.hoist?.label).toBe('SaaS Company');
    expect(after.operator.value).toBe('any');
    expect(after.children).toHaveLength(2);
  });
});
