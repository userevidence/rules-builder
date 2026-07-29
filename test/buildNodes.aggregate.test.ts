import { beforeEach, describe, expect, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { type ArrayNode, buildRoot, type LeafNode } from '../src/builder/buildNodes';
import { describeModelFields, resolve } from '../src/schema/surface';
import { parseSavedRule, type SavedRule, stringifySavedRule } from '../src/serialize';

const map: FieldMap = {
  models: {
    User: {
      fields: {
        tier: { kind: 'scalar', type: 'String' },
        orders: { kind: 'object', type: 'Order', isList: true },
        account: { kind: 'object', type: 'Account' }, // to-one relation
      },
    },
    Order: {
      fields: {
        total: { kind: 'scalar', type: 'Float' },
        quantity: { kind: 'scalar', type: 'Int' },
        label: { kind: 'scalar', type: 'String' }, // non-numeric scalar
        metadata: { kind: 'scalar', type: 'Json' }, // check()-only aggregate target
        occurredAt: { kind: 'scalar', type: 'DateTime' },
        status: { kind: 'enum', type: 'OrderStatus' },
      },
    },
    Account: { fields: { name: { kind: 'scalar', type: 'String' } } },
  },
  enums: { OrderStatus: ['pending', 'paid'] },
};

const lens = resolve({ maps: { app: map }, mapName: 'app', model: 'User' });
const fields = describeModelFields(lens, 'app', 'User');

let committed: Condition | undefined;
const build = (c: Condition) => {
  committed = undefined;
  return buildRoot(c, lens, fields, 4, (next) => {
    committed = next;
  });
};

// A `sum` over `orders.total` restricted to a date window, compared to a threshold.
const aggRule = (over: Partial<Record<string, unknown>> = {}): Condition => ({
  all: [
    {
      field: 'orders',
      aggregate: { mode: 'sum', field: 'total' },
      operator: 'greaterThan',
      value: 1000,
      condition: {
        all: [{ field: 'occurredAt', dateOperator: 'after', value: '2024-01-01', _id: 'w' }],
      },
      _id: 'agg',
      ...over,
    },
  ],
});

describe('buildRoot — aggregate nodes', () => {
  beforeEach(() => {
    committed = undefined;
  });

  test('an aggregate rule builds an array node with an aggregate facet, not a leaf', () => {
    const node = build(aggRule()).children[0];
    expect(node.kind).toBe('array');
    const a = node as ArrayNode;
    expect(a.field.value).toBe('orders');
    // element-mode operator is absent; the aggregate facet is present instead
    expect(a.arrayOperator).toBeUndefined();
    expect(a.aggregate).toBeDefined();
    expect(a.aggregate?.mode).toBe('sum');
    expect(a.aggregate?.field.value).toBe('total');
    expect(a.aggregate?.operator.value).toBe('greaterThan');
    expect(a.aggregate?.value.current).toBe(1000);
    expect(a.relation).toEqual({ mapName: 'app', modelName: 'Order' });
  });

  test('the aggregate field picker offers the related model numeric scalars + Json (tagged)', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    const opts = a.aggregate?.field.options ?? [];
    const byValue = Object.fromEntries(opts.map((o) => [o.value, o.compilesToPrisma]));
    // numeric scalars compile to Prisma; Json is offered but flagged; String/enum/DateTime excluded
    expect(Object.keys(byValue).sort()).toEqual(['metadata', 'quantity', 'total']);
    expect(byValue.total).toBe(true);
    expect(byValue.quantity).toBe(true);
    expect(byValue.metadata).toBe(false);
  });

  test('a numeric-scalar target validates and is marked compilesToPrisma', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    expect(a.valid).toBe(true);
    expect(a.aggregate?.field.valid).toBe(true);
    expect(a.aggregate?.field.compilesToPrisma).toBe(true);
  });

  test('a Json target validates (runnable via check) but is flagged check()-only', () => {
    const a = build(aggRule({ aggregate: { mode: 'sum', field: 'metadata' } }))
      .children[0] as ArrayNode;
    expect(a.valid).toBe(true); // not hard-blocked
    expect(a.aggregate?.field.valid).toBe(true);
    expect(a.aggregate?.field.compilesToPrisma).toBe(false);
  });

  test('a non-numeric scalar target (String) fails validation', () => {
    const a = build(aggRule({ aggregate: { mode: 'sum', field: 'label' } }))
      .children[0] as ArrayNode;
    expect(a.valid).toBe(false);
    expect(a.aggregate?.field.valid).toBe(false);
  });

  test('an aggregate whose field is not a list relation fails validation', () => {
    // `account` is a to-one relation, not a many/list — aggregate requires a list.
    const a = build(aggRule({ field: 'account', aggregate: { mode: 'sum', field: 'name' } }))
      .children[0] as ArrayNode;
    expect(a.valid).toBe(false);
  });

  test('notBetween is rejected (not in the supported comparison set)', () => {
    const a = build(aggRule({ operator: 'notBetween', value: [1, 2] })).children[0] as ArrayNode;
    expect(a.valid).toBe(false);
    expect(a.aggregate?.operator.options.map((o) => o.value)).not.toContain('notBetween');
  });

  test('authored windowing (take/skip/orderBy/filter) is rejected', () => {
    expect((build(aggRule({ take: 1 })).children[0] as ArrayNode).valid).toBe(false);
    expect((build(aggRule({ skip: 2 })).children[0] as ArrayNode).valid).toBe(false);
    expect(
      (build(aggRule({ orderBy: [{ field: 'total', dir: 'desc' }] })).children[0] as ArrayNode)
        .valid,
    ).toBe(false);
    expect((build(aggRule({ filter: { all: [] } })).children[0] as ArrayNode).valid).toBe(false);
  });

  test('the operator picker offers exactly the engine-supported comparisons', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    expect(a.aggregate?.operator.options.map((o) => o.value)).toEqual([
      'equals',
      'notEquals',
      'lessThan',
      'lessThanEquals',
      'greaterThan',
      'greaterThanEquals',
      'between',
    ]);
  });

  test('the element window is authored via the condition sub-builder scoped to the related model', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    expect(a.filter).toBeUndefined(); // no separate window control on an aggregate
    expect(a.condition?.kind).toBe('group');
    const inner = a.condition?.children[0] as LeafNode;
    expect(inner.field.value).toBe('occurredAt');
    // scoped to Order's fields, not User's
    expect(inner.field.options.map((o) => o.value).sort()).toEqual([
      'label',
      'metadata',
      'occurredAt',
      'quantity',
      'status',
      'total',
    ]);
  });

  test('setMode commits a new aggregate mode', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    a.aggregate?.setMode('avg');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect((child.aggregate as { mode: string }).mode).toBe('avg');
    expect((child.aggregate as { field: string }).field).toBe('total'); // target preserved
  });

  test('aggregate.field.set commits the new numeric target', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    a.aggregate?.field.set('quantity');
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect((child.aggregate as { field: string }).field).toBe('quantity');
    expect((child.aggregate as { mode: string }).mode).toBe('sum');
  });

  test('operator.set + value.set commit a between threshold', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    a.aggregate?.operator.set('between');
    const afterOp = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(afterOp.operator).toBe('between');
    // rebuild off the committed state so the value control sees the new operator shape
    const a2 = build(committed as Condition).children[0] as ArrayNode;
    expect(a2.aggregate?.value.shape).toBe('range');
    a2.aggregate?.value.set([100, 500]);
    const afterVal = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(afterVal.value).toEqual([100, 500]);
  });

  test('editing the element window commits back under the aggregate rule condition', () => {
    const a = build(aggRule({ condition: { all: [] } })).children[0] as ArrayNode;
    a.condition?.addRule();
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect((child.aggregate as { mode: string }).mode).toBe('sum');
    expect((child.condition as { all: unknown[] }).all).toHaveLength(1);
  });

  test('re-pointing the relation preserves aggregate mode + operator/value, clears the target', () => {
    const a = build(aggRule()).children[0] as ArrayNode;
    a.field.set('orders'); // same relation, exercises the aggregate-preserving branch
    const child = (committed as { all: Condition[] }).all[0] as Record<string, unknown>;
    expect(child.field).toBe('orders');
    expect((child.aggregate as { mode: string }).mode).toBe('sum');
    expect((child.aggregate as { field?: string }).field).toBeUndefined(); // reset
    expect(child.operator).toBe('greaterThan');
    expect(child.value).toBe(1000);
    expect(child._id).toBe('agg'); // identity preserved
  });

  test('round-trips through stringify/parse without shape drift', () => {
    const saved: SavedRule = {
      source: { maps: { app: map }, mapName: 'app', model: 'User' },
      rule: aggRule(),
    };
    const round = parseSavedRule(stringifySavedRule(saved));
    expect(round.rule).toEqual(saved.rule);
    // and the parsed rule still builds an aggregate node
    const a = build(round.rule).children[0] as ArrayNode;
    expect(a.aggregate?.mode).toBe('sum');
    expect(a.aggregate?.field.value).toBe('total');
  });
});
