import { afterEach, describe, expect, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode, LeafNode } from '../src/builder/buildNodes';
import { useRuleBuilder } from '../src/builder/useRuleBuilder';
import type { Decoration } from '../src/schema/decoration';
import { facetId, matchFacet, stampFacetIds } from '../src/schema/decoration';
import { resolve } from '../src/schema/surface';

afterEach(cleanup);

// The session escape hatch from facet capture. `__facetId` is the node's own
// facet state: the facet's id when attached (stamped at ingest), `null` when the
// user detaches to raw — recognition suspends and the identity rows unlock — and
// absent when the node is open to search. stripMeta drops the key before `value`
// emits, so nothing persists: a saved rule always reloads faceted.

const eavMap: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String' },
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
const where = { field: 'key', operator: 'equals', value: 'nps' };
const row = (value: string): Condition =>
  ({ field: 'value', operator: 'equals', value }) as Condition;
const savedFacet = (rows: Condition[]): Condition => ({
  all: [
    {
      field: 'customFields',
      arrayOperator: 'any',
      condition: { all: [where as Condition, ...rows] },
    } as Condition,
  ],
});

const rootGroup = (r: { root: unknown }) => r.root as GroupNode;
const facetNode = (r: { root: unknown }) => rootGroup(r).children[0] as ArrayNode;

describe('facetMode — detach to raw, session-only', () => {
  test('a matched facet reads faceted; detaching drops hoist, lock, and retyping', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    expect(facetNode(result.current).facetMode?.value).toBe('faceted');
    act(() => facetNode(result.current).facetMode?.set('raw'));
    const node = facetNode(result.current);
    expect(node.facetMode?.value).toBe('raw');
    expect(node.hoist).toBeUndefined();
    expect(node.lockedLeading).toBeUndefined();
    // The identity row is now an ordinary editable child.
    const identity = node.condition?.children[0] as LeafNode;
    expect(identity.kind).toBe('leaf');
    expect(identity.field.value).toBe('key');
    expect(typeof identity.value?.set).toBe('function');
  });

  test('detach never persists: value carries no __facetId and a reload recaptures', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    act(() => facetNode(result.current).facetMode?.set('raw'));
    const emitted = result.current.value;
    expect(JSON.stringify(emitted)).not.toContain('__facetId');
    const { result: reloaded } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue: emitted }),
    );
    expect(facetNode(reloaded.current).hoist?.label).toBe('NPS');
  });

  test('re-attach resumes recognition when the rows still form the facet', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    act(() => facetNode(result.current).facetMode?.set('raw'));
    act(() => facetNode(result.current).facetMode?.set('faceted'));
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('NPS');
    expect(node.lockedLeading).toBe(1);
  });

  test('editing the identity while raw legitimately un-facets: re-attach finds nothing', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    act(() => facetNode(result.current).facetMode?.set('raw'));
    act(() => {
      const identity = facetNode(result.current).condition?.children[0] as LeafNode;
      identity.value?.set('csat');
    });
    act(() => facetNode(result.current).facetMode?.set('faceted'));
    const node = facetNode(result.current);
    expect(node.hoist).toBeUndefined();
    expect(node.facetMode).toBeUndefined();
  });
});

describe('__facetId — ingest stamping and node-controlled matching', () => {
  const lens = resolve(eavSource);
  const nps = npsView.facets[0];

  test('stampFacetIds stamps a recognizable node with its facet id', () => {
    const stamped = stampFacetIds(savedFacet([row('9')]), lens, npsView) as {
      all: ({ __facetId?: string } & Condition)[];
    };
    expect(stamped.all[0].__facetId).toBe(facetId(nps));
  });

  test('null suspends matching; a stamped id pins it without a search', () => {
    const node = savedFacet([row('9')]).all?.[0] as Condition;
    expect(matchFacet(lens, npsView, { ...node, __facetId: null } as Condition)).toBeUndefined();
    // Pinned by id: resolves even when the shape alone would be ambiguous.
    expect(matchFacet(lens, npsView, { ...node, __facetId: facetId(nps) } as Condition)).toBe(nps);
    // An id that no longer resolves falls through to the ordinary search.
    expect(matchFacet(lens, npsView, { ...node, __facetId: '#gone' } as Condition)).toBe(nps);
  });
});

describe('the pin never exempts a node from being its facet (adversarial findings)', () => {
  test('editing away the identity breaks the bind — no badge over a drifted rule', () => {
    // A presence operator drops `condition` (identity where included). The stamped
    // id must NOT keep presenting the node as the facet over a rule that now means
    // "has any custom field at all".
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: eavSource,
        decoration: npsView,
        defaultValue: savedFacet([row('9')]),
      }),
    );
    expect(facetNode(result.current).hoist?.label).toBe('NPS');
    act(() => facetNode(result.current).arrayOperator?.set('notEmpty'));
    const node = facetNode(result.current);
    expect(node.hoist).toBeUndefined();
    expect(node.facetMode).toBeUndefined();
    expect(result.current.value).toEqual({
      all: [{ field: 'customFields', arrayOperator: 'notEmpty' }],
    });
  });

  test('an out-of-order identity is hoisted to leading at ingest, so the lock engages', () => {
    // Subset matching accepts the where anywhere in the block; the toggle lock
    // keys off the LEADING prefix. Ingest must reconcile the two, or the ALL/ANY
    // toggle ORs the identity into the user rows — the exact bug of ZLT-3899.
    const outOfOrder: Condition = {
      all: [
        {
          field: 'customFields',
          arrayOperator: 'any',
          condition: { all: [row('9'), where as Condition] },
        } as Condition,
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue: outOfOrder }),
    );
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('NPS');
    expect(node.lockedLeading).toBe(1);
    act(() => facetNode(result.current).condition?.operator.set('any'));
    const saved = (result.current.value as { all: Condition[] }).all[0] as {
      condition: { all?: Condition[] };
    };
    expect(saved.condition).toEqual({
      all: [expect.objectContaining(where), { any: [expect.objectContaining(row('9'))] }],
    });
  });
});

describe('branch facet — detach unlocks the identity clause', () => {
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
        ],
      },
    ],
  };

  test('detaching a branch group drops hoist and lock; re-attach restores both', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration, defaultValue }),
    );
    const group = () => rootGroup(result.current).children[0] as GroupNode;
    expect(group().facetMode?.value).toBe('faceted');
    act(() => group().facetMode?.set('raw'));
    expect(group().hoist).toBeUndefined();
    expect(group().lockedLeading).toBeUndefined();
    expect(group().facetMode?.value).toBe('raw');
    act(() => group().facetMode?.set('faceted'));
    expect(group().hoist?.label).toBe('SaaS Company');
    expect(group().lockedLeading).toBe(1);
  });
});
