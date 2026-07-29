import { afterEach, describe, expect, test } from 'bun:test';
import type { Bridge, Condition, FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode, LeafNode } from '../src/builder/buildNodes';
import { useRuleBuilder } from '../src/builder/useRuleBuilder';
import type { Decoration } from '../src/schema/decoration';

afterEach(cleanup);

const prisma: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        crmId: { kind: 'scalar', type: 'String' },
      },
    },
  },
};
const salesforce: FieldMap = {
  models: {
    Contact: {
      fields: {
        id: { kind: 'scalar', type: 'String' },
        arr: { kind: 'scalar', type: 'Int' },
      },
    },
  },
};
const bridges: Bridge[] = [
  {
    endpoints: [
      { fieldMap: 'salesforce', model: 'Contact', on: 'id' },
      { fieldMap: 'prisma', model: 'User', on: 'crmId' },
    ],
    cardinality: 'oneToMany',
  },
];
const source = { maps: { prisma, salesforce }, bridges, mapName: 'prisma', model: 'User' };

const view: Decoration = {
  facets: [{ path: 'salesforce:Contact.arr', label: 'Annual Revenue', icon: '💰' }],
};

const rootGroup = (r: { root: unknown }) => r.root as GroupNode;
const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };

describe('useRuleBuilder — view (hoisted roots)', () => {
  test('a hoisted bridge path shows up as a labeled root selector option', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source, decoration: view, defaultValue: seed }),
    );
    const leaf = rootGroup(result.current).children[0] as LeafNode;
    const option = leaf.field.options.find((o) => o.value === 'salesforce:Contact.arr');
    expect(option).toBeDefined();
    expect(option?.label).toBe('Annual Revenue');
    expect(option?.icon).toBe('💰'); // the icon reaches the picker menu, not just the collapsed node
    // the anchor model's own field is still offered — additive, not a replace.
    expect(leaf.field.options.some((o) => o.value === 'tier')).toBe(true);
  });

  test('a facet icon rides onto the collapsed node after selection', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source, decoration: view, defaultValue: seed }),
    );
    const leaf = rootGroup(result.current).children[0] as LeafNode;
    act(() => leaf.field.set('salesforce:Contact.arr'));
    const selected = rootGroup(result.current).children[0] as LeafNode;
    expect(selected.hoist?.icon).toBe('💰');
  });

  test('selecting a hoisted root emits the real dotted path as the rule field', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source, decoration: view, defaultValue: seed }),
    );
    const leaf = rootGroup(result.current).children[0] as LeafNode;
    act(() => leaf.field.set('salesforce:Contact.arr'));
    const emitted = (result.current.value as { all: Condition[] }).all[0] as {
      field: string;
      coerceType?: string;
    };
    expect(emitted.field).toBe('salesforce:Contact.arr');
    expect(emitted.coerceType).toBe('Int');
  });

  test('a seeded rule on a hoisted path resolves back as a valid, labeled row', () => {
    const defaultValue: Condition = {
      all: [{ field: 'salesforce:Contact.arr', operator: 'greaterThan', value: 1000 }],
    };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration: view, defaultValue }));
    const leaf = rootGroup(result.current).children[0] as LeafNode;
    expect(leaf.field.value).toBe('salesforce:Contact.arr');
    expect(leaf.field.valid).toBe(true);
    expect(leaf.valid).toBe(true);
  });
});

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
      kind: 'Int',
      label: 'NPS',
    },
  ],
};

describe('useRuleBuilder — collection & sliced facets', () => {
  test('selecting a sliced facet seeds an array node with the fixed where as leading condition', () => {
    const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue: seed }),
    );
    const row = rootGroup(result.current).children[0] as LeafNode;
    const npsOption = row.field.options.find((o) => o.label === 'NPS');
    if (!npsOption) throw new Error('NPS option not offered');
    act(() => row.field.set(npsOption.value));
    const node = (result.current.value as { all: Condition[] }).all[0] as {
      field: string;
      arrayOperator: string;
      condition: { all: Condition[] };
    };
    expect(node.field).toBe('customFields');
    expect(node.arrayOperator).toBe('any');
    // fixed where leads the condition block (no window filter).
    expect(node.condition.all[0]).toMatchObject({ field: 'key', operator: 'equals', value: 'nps' });
  });

  test('a wholesale-hoisted top relation is removed from the root selector (move, not copy)', () => {
    const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };
    const view: Decoration = { facets: [{ path: 'customFields', label: 'Enrichments' }] };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: view, defaultValue: seed }),
    );
    const row = rootGroup(result.current).children[0] as LeafNode;
    const values = row.field.options.map((o) => o.value);
    // the hoisted "Enrichments" entry is present; the raw `customFields` is gone.
    expect(values).toContain('customFields'); // the hoist's own id is the path
    expect(row.field.options.filter((o) => o.value === 'customFields')).toHaveLength(1);
    expect(row.field.options.find((o) => o.value === 'customFields')?.label).toBe('Enrichments');
  });
});

describe('useRuleBuilder — rehydration (detecting an aliased saved rule)', () => {
  test('a saved leaf-hoist rule is recognized and badged with the entry label', () => {
    const defaultValue: Condition = {
      all: [{ field: 'salesforce:Contact.arr', operator: 'greaterThan', value: 1000 }],
    };
    const { result } = renderHook(() => useRuleBuilder({ source, decoration: view, defaultValue }));
    const leaf = rootGroup(result.current).children[0] as LeafNode;
    expect(leaf.hoist?.label).toBe('Annual Revenue');
    expect(leaf.hoist?.icon).toBe('💰');
  });

  test('a saved sliced-collection rule collapses to the named entry, hidden op, locked leading, retyped value', () => {
    const defaultValue: Condition = {
      all: [
        {
          field: 'customFields',
          arrayOperator: 'any',
          condition: {
            all: [
              { field: 'key', operator: 'equals', value: 'nps' },
              { field: 'value', operator: 'greaterThan', value: 5 },
            ],
          },
        },
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue }),
    );
    const node = rootGroup(result.current).children[0] as ArrayNode;
    expect(node.kind).toBe('array');
    expect(node.hoist?.label).toBe('NPS');
    expect(node.arrayOperator.hidden).toBe(true);
    // canonical presentation: the rows group is the surface, identity out of view.
    // the kind override flows into the element surface: `value` offers numeric ops.
    const valueLeaf = node.condition?.children[0] as LeafNode;
    expect(valueLeaf.operator?.options.map((o) => o.value)).toContain('greaterThan');
  });

  test('a non-aliased array node is left as a plain builder (no hoist badge)', () => {
    const defaultValue: Condition = {
      all: [
        {
          field: 'customFields',
          arrayOperator: 'any',
          condition: { all: [{ field: 'key', operator: 'equals', value: 'other' }] },
        },
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration: npsView, defaultValue }),
    );
    const node = rootGroup(result.current).children[0] as ArrayNode;
    expect(node.hoist).toBeUndefined();
    expect(node.arrayOperator.hidden).toBeUndefined();
  });
});

const branchMap: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        account: { kind: 'object', type: 'Account' },
      },
    },
    Account: {
      fields: {
        industry: { kind: 'scalar', type: 'String' },
        arr: { kind: 'scalar', type: 'Int' },
        owner: { kind: 'object', type: 'Contact' },
        contracts: { kind: 'object', type: 'Contract', isList: true },
      },
    },
    Contact: { fields: { email: { kind: 'scalar', type: 'String' } } },
    Contract: { fields: { amount: { kind: 'scalar', type: 'Int' } } },
  },
};
const branchSource = { maps: { app: branchMap }, mapName: 'app', model: 'User' };
const asGroupNode = (n: unknown) => n as GroupNode;

describe('useRuleBuilder — branch facets (a to-one relation as a scoped group)', () => {
  const decoration: Decoration = { facets: [{ path: 'account', label: 'Company' }] };
  const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };

  test('selecting a branch facet seeds a group scoped to the related model', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration, defaultValue: seed }),
    );
    const row = rootGroup(result.current).children[0] as LeafNode;
    const companyOption = row.field.options.find((o) => o.label === 'Company');
    if (!companyOption) throw new Error('Company branch not offered');
    act(() => row.field.set(companyOption.value));
    // the row became a group whose first emitted leaf is an account.* dotted path.
    const emitted = (result.current.value as { all: Condition[] }).all[0] as { all: Condition[] };
    expect((emitted.all[0] as { field: string }).field).toMatch(/^account\./);
  });

  test('a saved account.* group rehydrates as the named branch, picker scoped + prefixed', () => {
    const defaultValue: Condition = {
      all: [{ all: [{ field: 'account.industry', operator: 'equals', value: 'tech' }] }],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration, defaultValue }),
    );
    const group = asGroupNode(rootGroup(result.current).children[0]);
    expect(group.kind).toBe('group');
    expect(group.hoist?.label).toBe('Company');
    // the scoped picker offers the related model's fields as prefixed paths, and
    // only scalars (the to-one `owner` relation is left out of v1's branch picker).
    const inner = group.children[0] as LeafNode;
    const values = inner.field?.options.map((o) => o.value) ?? [];
    expect(values).toContain('account.industry');
    expect(values).toContain('account.arr');
    // nested branch: a to-one inside the branch is descended, its leaves flattened.
    expect(values).toContain('account.owner.email');
    // a to-one relation itself is not a pickable value.
    expect(values).not.toContain('account.owner');
    // a list inside the branch is offered (it builds a nested array node).
    expect(values).toContain('account.contracts');
  });

  test('picking a list inside a branch builds a nested array node', () => {
    const defaultValue: Condition = {
      all: [{ all: [{ field: 'account.industry', operator: 'equals', value: 'tech' }] }],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration, defaultValue }),
    );
    const group = asGroupNode(rootGroup(result.current).children[0]);
    const inner = group.children[0] as LeafNode;
    const contracts = inner.field?.options.find((o) => o.value === 'account.contracts');
    if (!contracts) throw new Error('nested list not offered in branch');
    act(() => inner.field?.set('account.contracts'));
    const emitted = (result.current.value as { all: [{ all: [Condition] }] }).all[0].all[0] as {
      field: string;
      arrayOperator: string;
    };
    expect(emitted.field).toBe('account.contracts');
    expect(emitted.arrayOperator).toBeDefined();
  });

  test('retags the root and list relations via labels.models', () => {
    const decoration: Decoration = {
      labels: {
        models: {
          'app:User': { label: 'Customer' }, // the root/anchor
          CustomField: { label: 'Enrichments' }, // a (list) relation target
        },
      },
      facets: [],
    };
    const seed: Condition = { all: [{ field: 'tier', operator: 'equals', value: 'gold' }] };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: eavSource, decoration, defaultValue: seed }),
    );
    const root = asGroupNode(result.current.root as unknown);
    expect(root.label).toBe('Customer'); // the root is retagged
    const row = root.children[0] as LeafNode;
    // the `customFields` list relation reads as its target model's label.
    expect(row.field?.options.find((o) => o.value === 'customFields')?.label).toBe('Enrichments');
  });

  test('the ROOT group is never captured by a whereless branch facet', () => {
    // repro: branch `account` (no where) + leaf hoist `account.industry`; a rule
    // whose only leaf sits under `account.` must not turn the root into the branch.
    const mixed: Decoration = {
      facets: [
        { path: 'account', label: 'Company' },
        { path: 'account.industry', label: 'Industry' },
      ],
    };
    const defaultValue: Condition = {
      all: [{ field: 'account.industry', operator: 'equals', value: 'tech' }],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({ source: branchSource, decoration: mixed, defaultValue }),
    );
    const root = asGroupNode(result.current.root as unknown);
    expect(root.hoist).toBeUndefined();
    // the anchor's own fields are still offered at the root — the scope wasn't swapped.
    const row = root.children[0] as LeafNode;
    const values = row.field?.options.map((o) => o.value) ?? [];
    expect(values).toContain('tier');
    expect(values).toContain('account.industry'); // the leaf hoist
  });
});
