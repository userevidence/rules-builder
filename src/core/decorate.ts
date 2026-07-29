import type { Condition } from '@inixiative/json-rules';

type Rec = Record<string, unknown>;
const isObj = (c: unknown): c is Rec => typeof c === 'object' && c !== null;

const groupKey = (c: Rec): 'all' | 'any' | undefined =>
  Array.isArray(c.all) ? 'all' : Array.isArray(c.any) ? 'any' : undefined;

const groupChildren = (c: Rec, key: 'all' | 'any'): Condition[] => c[key] as Condition[];

export const switchGroupOperator = (node: Condition, kind: 'all' | 'any'): Condition => {
  if (!isObj(node)) throw new Error('switchGroupOperator: not a compound');
  const rec = node as Rec;
  const key = groupKey(rec);
  if (!key) throw new Error('switchGroupOperator: node is not an all/any compound');
  const next: Rec = { [kind]: groupChildren(rec, key) };
  if (rec._groupId !== undefined) next._groupId = rec._groupId;
  if (rec.error !== undefined) next.error = rec.error;
  return next as Condition;
};

const SUB_CONDITION_KEYS = ['condition', 'filter'] as const;

export const trimEmptyGroups = (node: Condition): Condition | undefined => {
  if (!isObj(node)) return node;
  const rec = node as Rec;
  const key = groupKey(rec);
  if (!key) {
    // Leaf / array / aggregate rule: trim its nested condition & filter sub-trees.
    let next: Rec | undefined;
    for (const sub of SUB_CONDITION_KEYS) {
      if (!isObj(rec[sub])) continue;
      const trimmed = trimEmptyGroups(rec[sub] as Condition);
      if (trimmed === rec[sub]) continue;
      next = next ?? { ...rec };
      if (trimmed === undefined) delete next[sub];
      else next[sub] = trimmed;
    }
    return (next ?? node) as Condition;
  }
  const kept = groupChildren(rec, key)
    .map(trimEmptyGroups)
    .filter((c): c is Condition => c !== undefined);
  if (kept.length === 0) return undefined;
  const next: Rec = { [key]: kept };
  if (rec._groupId !== undefined) next._groupId = rec._groupId;
  if (rec.error !== undefined) next.error = rec.error;
  return next as Condition;
};

// Removes editor metadata deeply. Convention: meta keys are `_`-prefixed, so this
// is artifact-agnostic — usable on any tree (conditions, maps, lenses, …).
export const stripMeta = <T>(node: T): T => {
  if (!isObj(node as unknown)) return node;
  if (Array.isArray(node)) return node.map((x) => stripMeta(x)) as unknown as T;
  const out: Rec = {};
  for (const [k, v] of Object.entries(node as Rec)) {
    if (k.startsWith('_')) continue;
    out[k] = stripMeta(v);
  }
  return out as T;
};

const defaultMakeId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const withIds = (node: Condition, makeId: () => string = defaultMakeId): Condition => {
  if (!isObj(node)) return node;
  const rec = node as Rec;
  const key = groupKey(rec);
  if (key) {
    const next: Rec = { ...rec, [key]: groupChildren(rec, key).map((c) => withIds(c, makeId)) };
    if (next._groupId === undefined) next._groupId = makeId();
    return next as Condition;
  }
  const next: Rec = { ...rec };
  for (const sub of SUB_CONDITION_KEYS) {
    if (isObj(next[sub])) next[sub] = withIds(next[sub] as Condition, makeId);
  }
  if (next._id === undefined) next._id = makeId();
  return next as Condition;
};
