import type { Condition } from '@inixiative/json-rules';
import type { BuilderField } from '../schema/surface';

type Rec = Record<string, unknown>;

export const isGroupNode = (n: Condition): boolean =>
  typeof n === 'object' && n !== null && ('all' in n || 'any' in n);

export const isArrayNode = (n: Condition): boolean =>
  typeof n === 'object' && n !== null && 'arrayOperator' in n;

/** An aggregate rule (`sum`/`avg` over a list relation) — carries an `aggregate`
 *  descriptor instead of an `arrayOperator`. Built as an {@link ArrayNode} with its
 *  `aggregate` facet populated. */
export const isAggregateNode = (n: Condition): boolean =>
  typeof n === 'object' && n !== null && 'aggregate' in n;

export const groupOperatorOf = (n: Condition): 'all' | 'any' =>
  typeof n === 'object' && n !== null && 'any' in n ? 'any' : 'all';

export const groupChildrenOf = (n: Condition): Condition[] => {
  const r = n as Rec;
  return (Array.isArray(r.all) ? r.all : Array.isArray(r.any) ? r.any : []) as Condition[];
};

export const nodeKey = (n: Condition, index: number): string => {
  const r = n as Rec;
  return (r._groupId as string) ?? (r._id as string) ?? String(index);
};

const firstOperator = (
  field: BuilderField,
): { key: 'operator' | 'dateOperator'; op: string } | null => {
  if (field.operators.field.length > 0) return { key: 'operator', op: field.operators.field[0] };
  if (field.operators.date.length > 0) return { key: 'dateOperator', op: field.operators.date[0] };
  return null;
};

export const ruleForField = (field: BuilderField, keepId?: string): Condition => {
  const id = keepId ? { _id: keepId } : {};
  // A hoisted collection entry carries its own seed (array node + slice/operator).
  if (field.seed) return { ...(field.seed as object), ...id } as Condition;
  // A list/relation field is an array rule: a predicate/count/presence over its elements.
  if (field.isList) return { field: field.name, arrayOperator: 'notEmpty', ...id } as Condition;
  const first = firstOperator(field);
  if (!first) return { field: field.name, operator: 'equals', value: '', ...id } as Condition;
  return { field: field.name, [first.key]: first.op, value: '', ...id } as Condition;
};

export const defaultRule = (fields: BuilderField[]): Condition => {
  const scalar = fields.find((f) => firstOperator(f) !== null);
  if (scalar) return ruleForField(scalar);
  const list = fields.find((f) => f.isList);
  if (list) return ruleForField(list);
  return fields[0]
    ? ruleForField(fields[0])
    : ({ field: '', operator: 'equals', value: '' } as Condition);
};
