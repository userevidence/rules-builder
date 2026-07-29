import { describe, expect, test } from 'bun:test';
import {
  type Bridge,
  type Condition,
  check,
  createLens,
  exposedSurface,
  type FieldMap,
} from '@inixiative/json-rules';
import {
  consumedTopFields,
  type Decoration,
  describeFacets,
  matchFacet,
  validateDecoration,
} from '../src/schema/decoration';

const prisma: FieldMap = {
  models: {
    User: {
      fields: {
        id: { kind: 'scalar', type: 'String' },
        crmId: { kind: 'scalar', type: 'String' },
        tier: { kind: 'scalar', type: 'String', values: ['gold', 'silver'] },
        account: { kind: 'object', type: 'Account' },
      },
    },
    Account: {
      fields: {
        id: { kind: 'scalar', type: 'String' },
        industry: { kind: 'scalar', type: 'String' },
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

const lens = exposedSurface(
  createLens({ maps: { prisma, salesforce }, bridges, mapName: 'prisma', model: 'User' }),
);

const byName = (decoration: Decoration) =>
  Object.fromEntries(describeFacets(lens, decoration).map((f) => [f.name, f]));

describe('describeFacets — leaf facets', () => {
  test('hoists a same-map relation leaf; name is the full path so emit is unchanged', () => {
    const f = byName({ facets: [{ path: 'account.industry' }] })['account.industry'];
    expect(f.kind).toBe('String');
    expect(f.operators.field).toContain('contains');
    expect(f.name).toBe('account.industry');
  });

  test('hoists a bridge-crossing leaf from another source', () => {
    const f = byName({ facets: [{ path: 'salesforce:Contact.arr' }] })['salesforce:Contact.arr'];
    expect(f.kind).toBe('Int');
    expect(f.operators.field).toContain('between');
  });

  test('inline label + icon override the raw field name', () => {
    const f = byName({
      facets: [{ path: 'salesforce:Contact.arr', label: 'Annual Revenue', icon: '💰' }],
    })['salesforce:Contact.arr'];
    expect(f.label).toBe('Annual Revenue');
    expect(f.icon).toBe('💰');
  });

  test('relabels structurally; a path key wins over a structural key', () => {
    const structural = byName({
      facets: [{ path: 'account.industry' }],
      labels: { fields: { 'Account.industry': { label: 'Industry' } } },
    })['account.industry'];
    expect(structural.label).toBe('Industry');

    const path = byName({
      facets: [{ path: 'account.industry' }],
      labels: {
        fields: {
          'Account.industry': { label: 'Structural' },
          'account.industry': { label: 'Path' },
        },
      },
    })['account.industry'];
    expect(path.label).toBe('Path');
  });

  test('drops an unresolvable path', () => {
    expect(describeFacets(lens, { facets: [{ path: 'tier.nope' }, { path: 'ghost' }] })).toEqual(
      [],
    );
  });
});

const eav = exposedSurface(
  createLens({
    maps: {
      prisma: {
        models: {
          User: {
            fields: {
              orders: { kind: 'object', type: 'Order', isList: true },
              customFields: { kind: 'object', type: 'CustomField', isList: true },
              account: { kind: 'object', type: 'Account' },
            },
          },
          Account: {
            fields: { contracts: { kind: 'object', type: 'Contract', isList: true } },
          },
          Contract: { fields: { amount: { kind: 'scalar', type: 'Int' } } },
          Order: {
            fields: {
              total: { kind: 'scalar', type: 'Int' },
              items: { kind: 'object', type: 'Item', isList: true },
              customFields: { kind: 'object', type: 'CustomField', isList: true },
            },
          },
          Item: { fields: { sku: { kind: 'scalar', type: 'String' } } },
          CustomField: {
            fields: {
              key: { kind: 'scalar', type: 'String' },
              value: { kind: 'scalar', type: 'String' },
              score: { kind: 'scalar', type: 'Int' },
              status: { kind: 'scalar', type: 'String' },
            },
          },
        },
      },
    },
    mapName: 'prisma',
    model: 'User',
  }),
);

describe('describeFacets — collection facets', () => {
  test('a list-crossing path seeds an array node (never a broken flat leaf)', () => {
    const [f] = describeFacets(eav, { facets: [{ path: 'orders.total', label: 'Order total' }] });
    expect(f.isList).toBe(true);
    expect(f.seed).toMatchObject({
      field: 'orders',
      arrayOperator: 'any',
      condition: { all: [{ field: 'total' }] },
    });
  });

  test('single boundary: the fixed `where` leads the destination condition, value follows', () => {
    const [f] = describeFacets(eav, {
      facets: [
        {
          path: 'customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          kind: 'Int',
          label: 'NPS',
        },
      ],
    });
    const seed = f.seed as { condition: { all: Condition[] }; filter?: unknown };
    expect(seed.condition.all[0]).toMatchObject({ field: 'key', value: 'nps' });
    // The user's rows live in their own trailing group — the canonical facet shape.
    expect((seed.condition.all[1] as { all: Condition[] }).all[0]).toMatchObject({
      field: 'value',
    });
    // no window filter — the fixed where is a leading condition.
    expect(seed.filter).toBeUndefined();
  });

  test('multi boundary: defaultWhere is one operator per array traversal; the where lands at the destination model', () => {
    const [f] = describeFacets(eav, {
      facets: [
        {
          path: 'orders.customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          defaultWhere: ['all', 'any'], // orders, then customFields
          kind: 'Int',
          label: 'NPS across orders',
        },
      ],
    });
    // outer = the upstream traversal `orders`, crossed with the given `all`.
    const seed = f.seed as {
      field: string;
      arrayOperator: string;
      condition: { all: Condition[] };
    };
    expect(seed.field).toBe('orders');
    expect(seed.arrayOperator).toBe('all');
    // its single child is the destination `customFields` node, where the where sits.
    const dest = seed.condition.all[0] as {
      field: string;
      arrayOperator: string;
      condition: { all: Condition[] };
    };
    expect(dest.field).toBe('customFields');
    expect(dest.arrayOperator).toBe('any');
    expect(dest.condition.all[0]).toMatchObject({ field: 'key', value: 'nps' });
    expect((dest.condition.all[1] as { all: Condition[] }).all[0]).toMatchObject({
      field: 'value',
    });
  });

  test('the upstream traversal defaults to `any` when defaultWhere is omitted', () => {
    const [f] = describeFacets(eav, {
      facets: [
        {
          path: 'orders.customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
        },
      ],
    });
    expect((f.seed as { arrayOperator: string }).arrayOperator).toBe('any');
  });

  test('the seeded fixed-where node evaluates as "the NPS element > 5"', () => {
    const [f] = describeFacets(eav, {
      facets: [
        {
          path: 'customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          kind: 'Int',
        },
      ],
    });
    const seed = f.seed as {
      field: string;
      arrayOperator: string;
      condition: { all: Condition[] };
    };
    const rule = {
      ...seed,
      condition: {
        all: [seed.condition.all[0], { field: 'value', operator: 'greaterThan', value: 5 }],
      },
    } as Condition;
    expect(
      check(rule, {
        customFields: [
          { key: 'nps', value: 9 },
          { key: 'tier', value: 1 },
        ],
      }),
    ).toBe(true);
    expect(check(rule, { customFields: [{ key: 'nps', value: 3 }] })).not.toBe(true);
  });

  test('nested lists seed nested array nodes (never a flat two-list path) and evaluate', () => {
    const [f] = describeFacets(eav, { facets: [{ path: 'orders.items.sku', label: 'SKU' }] });
    expect(f.seed).toMatchObject({
      field: 'orders',
      arrayOperator: 'any',
      condition: {
        all: [{ field: 'items', arrayOperator: 'any', condition: { all: [{ field: 'sku' }] } }],
      },
    });
    const seed = f.seed as { condition: { all: [{ condition: { all: [Condition] } }] } };
    const inner = seed.condition.all[0];
    const rule = {
      ...(f.seed as object),
      condition: {
        all: [{ ...inner, condition: { all: [{ field: 'sku', operator: 'equals', value: 'x' }] } }],
      },
    } as Condition;
    expect(check(rule, { orders: [{ items: [{ sku: 'y' }, { sku: 'x' }] }] })).toBe(true);
    expect(check(rule, { orders: [{ items: [{ sku: 'y' }] }] })).not.toBe(true);
  });

  test('multi-hop: reaches a list through a to-one relation and emits a resolver field', () => {
    const out = describeFacets(eav, {
      facets: [{ path: 'account.contracts.amount', label: 'Contract' }],
    });
    const selector = out.find((f) => f.seed);
    expect(selector?.seed).toMatchObject({ field: 'account.contracts', arrayOperator: 'any' });
    const resolver = out.find((f) => f.name === 'account.contracts');
    expect(resolver?.selectable).toBe(false);
    expect(resolver?.relation).toMatchObject({ modelName: 'Contract' });
  });
});

describe('consumedTopFields / matchFacet', () => {
  const npsDecoration: Decoration = {
    facets: [
      {
        path: 'customFields.value',
        where: { field: 'key', operator: 'equals', value: 'nps' },
        kind: 'Int',
        label: 'NPS',
      },
      { path: 'tier' },
    ],
  };

  test('a wholesale bare hoist consumes its top field; where/deep leaves it', () => {
    const consumed = consumedTopFields({
      facets: [
        { path: 'orders' },
        { path: 'orders.total' },
        { path: 'customFields.value', where: { field: 'key', operator: 'equals', value: 'x' } },
      ],
    });
    expect([...consumed]).toEqual(['orders']);
  });

  test('recognizes a saved node by its leading fixed-where block', () => {
    const node = {
      field: 'customFields',
      arrayOperator: 'any',
      condition: {
        all: [
          { field: 'key', operator: 'equals', value: 'nps' },
          { field: 'value', operator: 'greaterThan', value: 5 },
        ],
      },
    } as Condition;
    expect(matchFacet(eav, npsDecoration, node)?.label).toBe('NPS');
  });

  test('recognizes a multi-boundary saved node by descending to the destination where', () => {
    const decoration: Decoration = {
      facets: [
        {
          path: 'orders.customFields.value',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          kind: 'Int',
          label: 'NPS across orders',
        },
      ],
    };
    const [f] = describeFacets(eav, decoration);
    // round-trip the emitted seed: it should collapse back to its facet.
    expect(matchFacet(eav, decoration, f.seed as Condition)?.label).toBe('NPS across orders');
    // and it evaluates as "some order has an nps custom field > 5".
    const seed = f.seed as { condition: { all: [{ condition: { all: [Condition, Condition] } }] } };
    const dest = seed.condition.all[0];
    const rule = {
      ...(f.seed as object),
      condition: {
        all: [
          {
            ...dest,
            condition: {
              all: [dest.condition.all[0], { field: 'value', operator: 'greaterThan', value: 5 }],
            },
          },
        ],
      },
    } as Condition;
    expect(check(rule, { orders: [{ customFields: [{ key: 'nps', value: 9 }] }] })).toBe(true);
    expect(check(rule, { orders: [{ customFields: [{ key: 'nps', value: 1 }] }] })).not.toBe(true);
  });

  test('a whereless deep-leaf facet only collapses a node that references its leaf', () => {
    const decoration: Decoration = { facets: [{ path: 'orders.total', label: 'Order total' }] };
    const onTotal = {
      field: 'orders',
      arrayOperator: 'any',
      condition: { all: [{ field: 'total', operator: 'greaterThan', value: 5 }] },
    } as Condition;
    const onSomethingElse = {
      field: 'orders',
      arrayOperator: 'any',
      condition: {
        all: [
          {
            field: 'items',
            arrayOperator: 'any',
            condition: { all: [{ field: 'sku', value: 'x' }] },
          },
        ],
      },
    } as Condition;
    expect(matchFacet(eav, decoration, onTotal)?.label).toBe('Order total');
    expect(matchFacet(eav, decoration, onSomethingElse)).toBeUndefined();
  });

  test('a different leading where is not the NPS facet', () => {
    const node = {
      field: 'customFields',
      arrayOperator: 'any',
      condition: { all: [{ field: 'key', operator: 'equals', value: 'csat' }] },
    } as Condition;
    expect(matchFacet(eav, npsDecoration, node)).toBeUndefined();
  });
});

describe('describeFacets / matchFacet — branch facets', () => {
  const branchLens = exposedSurface(
    createLens({
      maps: {
        app: {
          models: {
            User: { fields: { account: { kind: 'object', type: 'Account' } } },
            Account: {
              fields: {
                industry: { kind: 'scalar', type: 'String' },
                tier: { kind: 'scalar', type: 'String' },
              },
            },
          },
        },
      },
      mapName: 'app',
      model: 'User',
    }),
  );

  test('a to-one relation seeds a group of prefixed conditions', () => {
    const [f] = describeFacets(branchLens, { facets: [{ path: 'account', label: 'Company' }] });
    expect(f.seed).toMatchObject({ all: [{ field: 'account.industry' }] });
  });

  test('recognizes a saved account.* group as the branch, by prefix', () => {
    const decoration: Decoration = { facets: [{ path: 'account', label: 'Company' }] };
    const node = {
      all: [{ field: 'account.tier', operator: 'equals', value: 'gold' }],
    } as Condition;
    expect(matchFacet(branchLens, decoration, node)?.label).toBe('Company');
  });

  test('validateDecoration rejects two whereless branches on the same relation', () => {
    const violations = validateDecoration(branchLens, {
      facets: [
        { path: 'account', label: 'Company' },
        { path: 'account', label: 'Org' },
      ],
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('validateDecoration — collision-free guarantee', () => {
  test('accepts prefix-free facets on the same list', () => {
    const violations = validateDecoration(eav, {
      facets: [
        { path: 'customFields.value', where: { field: 'key', operator: 'equals', value: 'nps' } },
        { path: 'customFields.value', where: { field: 'key', operator: 'equals', value: 'csat' } },
      ],
    });
    expect(violations).toEqual([]);
  });

  test('rejects a no-where facet colliding with a where facet on the same list', () => {
    const violations = validateDecoration(eav, {
      facets: [
        { path: 'customFields.value', label: 'All custom fields' }, // no where → matches everything
        {
          path: 'customFields.score',
          where: { field: 'key', operator: 'equals', value: 'nps' },
          label: 'NPS',
        },
      ],
    });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain('collide');
  });

  test('rejects `where` on a leaf facet (a leaf ignores it, and it would dup the picker option)', () => {
    const violations = validateDecoration(lens, {
      facets: [{ path: 'tier', where: { field: 'x', operator: 'equals', value: 'a' } }],
    });
    expect(violations.some((v) => v.includes('leaf facet'))).toBe(true);
  });

  test('requires one traversal operator per array boundary', () => {
    // two boundaries (orders, customFields) but one operator → violation.
    const short = validateDecoration(eav, {
      facets: [{ path: 'orders.customFields.value', defaultWhere: ['any'] }],
    });
    expect(short.some((v) => v.includes('traversal operator'))).toBe(true);
    // the right count is accepted.
    const ok = validateDecoration(eav, {
      facets: [{ path: 'orders.customFields.value', defaultWhere: ['any', 'any'] }],
    });
    expect(ok).toEqual([]);
  });

  test('rejects a duplicate facet id and an unresolvable path', () => {
    const violations = validateDecoration(eav, {
      facets: [
        { path: 'customFields.value', where: { field: 'key', operator: 'equals', value: 'nps' } },
        { path: 'customFields.value', where: { field: 'key', operator: 'equals', value: 'nps' } },
        { path: 'ghost.field' },
      ],
    });
    expect(violations.some((v) => v.includes('duplicate'))).toBe(true);
    expect(violations.some((v) => v.includes('does not resolve'))).toBe(true);
  });
});
