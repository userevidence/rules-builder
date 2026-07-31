import {
  type Condition,
  checkRuleAgainstLens,
  createLens,
  exposedSurface,
  type FieldKind,
  type Lens,
  type ValueShape,
} from '@inixiative/json-rules';
import { switchGroupOperator } from '../core/decorate';
import { addRule, getNode, type RulePath, removeNode, setNode } from '../core/tree';
import {
  consumedTopFields,
  type Decoration,
  describeFacets,
  type Facet,
  facetBranchScope,
  facetElementLeaf,
  facetId,
  isPreset,
  leadingIdentityCount,
  leadingWhereCount,
  matchFacet,
  modelDecor,
  relabelRelations,
  scopedDecoration,
  selectorsApply,
  writeSelectorClause,
} from '../schema/decoration';
import type { BuilderField, SurfaceOptions } from '../schema/surface';
import { describeModelFields, valueShapeForOperator } from '../schema/surface';
import {
  defaultRule,
  groupChildrenOf,
  groupOperatorOf,
  isAggregateNode,
  isArrayNode,
  isGroupNode,
  ruleForField,
} from './nodes';

export type PickOption = {
  value: string;
  label: string;
  icon?: string;
  groups?: string[];
  /** Set on an aggregate numeric-target option: `false` marks a `Json` field, which
   *  the in-memory `check()` aggregates but `toPrisma()` cannot compile. */
  compilesToPrisma?: boolean;
};

export type FieldControl = {
  value?: string;
  options: PickOption[];
  set: (name: string) => void;
  /** False when the selected field does not resolve in the (narrowed) surface. */
  valid: boolean;
  /** The selected base field is a `Json` column → a freeform sub-path may be appended. */
  acceptsSubPath?: boolean;
  /** The current JSON sub-path (the segment after the base field), if any. */
  subPath?: string;
  /** Set the freeform sub-path; composes `base[.sub]` into the rule's `field`. */
  setSubPath?: (sub: string) => void;
};
export type OperatorControl = {
  value?: string;
  options: PickOption[];
  set: (op: string) => void;
};
export type ValueControl = {
  current: unknown;
  shape: ValueShape;
  /** The field's kind (String/Int/Boolean/DateTime/Enum…) → pick number vs text vs date. */
  kind?: FieldKind;
  /** Present when the value is a constrained set (enum/sourced) → render a select/chips. */
  options?: PickOption[];
  /** False when the value falls outside the field's allowed (enum/sourced) set. */
  valid: boolean;
  set: (value: unknown) => void;
  /** 'value' = a literal; 'path' = compare against another field's value by dotted path;
   *  'bind' = a named binding supplied at execution time (`{ bind }`). */
  mode: 'value' | 'path' | 'bind';
  setMode: (mode: 'value' | 'path' | 'bind') => void;
  /** Present in 'path' mode — the RHS field-reference path (e.g. `user.email`). */
  path?: { value?: string; set: (p: string) => void };
  /** Present in 'bind' mode — the binding name resolved at execution time. */
  bind?: { value?: string; set: (name: string) => void };
};

export type LeafNode = {
  kind: 'leaf';
  id: string;
  path: RulePath;
  depth: number;
  /** A field comparison (`field`) or a raw `true`/`false` literal (`boolean`). */
  leafKind: 'field' | 'boolean';
  /** Flip the leaf between a field comparison and a true/false literal. */
  setLeafKind: (k: 'field' | 'boolean') => void;
  /** Present when `leafKind === 'boolean'` — the literal value. */
  literal?: { value: boolean; set: (v: boolean) => void };
  /** Present when `leafKind === 'field'`. */
  field?: FieldControl;
  operator?: OperatorControl;
  value?: ValueControl;
  /** Set when this leaf is a hoisted alias (a {@link Decoration} leaf facet) — a
   *  renderer shows the entry's label/icon instead of the raw path. */
  hoist?: HoistBadge;
  /** Set when this node is a **preset** alias — a renderer shows only the name; the
   *  whole condition is opaque, with no field/operator/value pickers. */
  atomic?: boolean;
  /** Gated against the allowed value set (sourced/enum) via checkRuleAgainstLens. */
  valid: boolean;
  remove: () => void;
};

/** Marks a node the builder recognized as a hoisted {@link Decoration} facet, so a
 *  renderer collapses it to the named field instead of raw internals. */
export type HoistBadge = { id: string; label: string; icon?: string };

export type GroupNode = {
  kind: 'group';
  id: string;
  path: RulePath;
  depth: number;
  operator: { value: 'all' | 'any'; set: (op: 'all' | 'any') => void };
  children: BuilderNode[];
  addRule: () => void;
  addGroup: () => void;
  canAddGroup: boolean;
  /** A display name for the group's model — the retagged **root/anchor** (from
   *  `labels.models`) at the top level, or a branch facet's label. A renderer may
   *  show it as a header. */
  label?: string;
  /** Set when this group is a hoisted **branch** facet (a to-one relation surfaced
   *  as a scoped group) — its field picker is scoped to the related model and a
   *  renderer shows the entry's name. */
  hoist?: HoistBadge;
  /** Set when this group is a **preset** alias — a renderer shows only the name;
   *  the whole condition is opaque, with no pickers or add-rule. */
  atomic?: boolean;
  /** Present when a facet governs this node or a detach is active. `raw` suspends
   *  recognition for the session — hoist/lock drop and the identity rows render
   *  as plain editable children. Session-only: the `__facetId` meta backing it is
   *  stripped before `value` emits, so a saved rule always reloads faceted. */
  facetMode?: FacetModeControl;
  /** The matched branch facet's declared inner selector rows (mirrors
   *  {@link ArrayNode.selectors}). */
  selectors?: { field: string; label?: string; anyLabel?: string }[];
  /** The canonical selector clauses hoisted out of the rows surface (mirrors
   *  {@link ArrayNode.selectorClauses}); absent when the group isn't canonical. */
  selectorClauses?: BuilderNode[];
  /** Create/replace (value) or remove (`null`) the clause for a declared selector
   *  field — writes into the top of the group itself, where branch identity
   *  lives, preserving the canonical shape and the rows group's operator. */
  setSelectorClause?: (field: string, value: unknown | null) => void;
  remove?: () => void;
};

export type FacetModeControl = {
  value: 'faceted' | 'raw';
  set: (mode: 'faceted' | 'raw') => void;
};

/**
 * A list/relation field rule: a predicate / count / presence over the field's
 * elements. `condition` (predicate + count) and `filter` (window: keep elements
 * matching it first) are nested sub-builders scoped to the *related* model's
 * surface — author them like any other group.
 */
/**
 * The numeric-aggregate facet of an {@link ArrayNode} — present instead of
 * `arrayOperator` when the node is an `AggregateRule` (`sum`/`avg` over the list
 * elements compared to a threshold). The element window (e.g. a date range) is
 * authored via the shared `condition` sub-builder, NOT a separate window control:
 * the engine expresses the window as the element `condition`, and `toPrisma()`
 * rejects authored windowing (orderBy/take/skip/filter).
 */
export type AggregateControl = {
  /** `sum` or `avg`. Only these two — {@link AGGREGATE_MODES}. */
  mode: 'sum' | 'avg';
  setMode: (mode: 'sum' | 'avg') => void;
  modeOptions: PickOption[];
  /** Picker over the RELATED model's aggregatable numeric scalars + `Json` columns.
   *  Each option carries `compilesToPrisma`; `compilesToPrisma` here reflects the
   *  currently-selected target (`false` = a `Json` target, check()-only). */
  field: {
    value?: string;
    options: PickOption[];
    set: (name: string) => void;
    /** False when the selected target is missing or not aggregatable. */
    valid: boolean;
    /** False when the selected target is a `Json` column (check()-only). */
    compilesToPrisma?: boolean;
  };
  /** The threshold comparison — restricted to {@link AGGREGATE_OPERATORS}. */
  operator: OperatorControl;
  /** The threshold value: a number (single-value ops) or `[number, number]` (between). */
  value: { current?: number | [number, number]; shape: ValueShape; set: (v: unknown) => void };
};

export type ArrayNode = {
  kind: 'array';
  id: string;
  path: RulePath;
  depth: number;
  field: FieldControl;
  /** Present for element rules (presence/count/predicate); absent on an aggregate
   *  node, which carries {@link ArrayNode.aggregate} instead. */
  arrayOperator?: {
    value?: string;
    options: PickOption[];
    set: (op: string) => void;
    /** Editable but hidden by default — a hoisted collection ships a sensible
     *  default (`any`); a renderer reveals this control behind an "advanced"
     *  affordance rather than showing it inline. */
    hidden?: boolean;
  };
  /** Present instead of `arrayOperator` when this is an `AggregateRule`. */
  aggregate?: AggregateControl;
  /** Set when this array node is a hoisted alias (a {@link Decoration} facet) — a
   *  renderer collapses it to the named field. */
  hoist?: HoistBadge;
  /** Set when this node is a **preset** alias — a renderer shows only the name; the
   *  whole condition is opaque, with no pickers. */
  atomic?: boolean;
  /** Present when a facet governs (or could govern) this node — see
   *  {@link GroupNode.facetMode}. */
  facetMode?: FacetModeControl;
  /** The matched facet's declared inner selector rows (e.g. the field picker
   *  inside a source container) — a renderer draws these generically instead of
   *  hardcoding field paths. */
  selectors?: { field: string; label?: string; anyLabel?: string }[];
  /** The canonical selector clauses (at most one per declared selector field),
   *  hoisted OUT of `condition` so the rows toggle can never absorb them. A
   *  renderer's selector dropdowns read and edit through these nodes — usually a
   *  leaf, but a complex selector (an internal OR block, "question is Q1 or Q2")
   *  surfaces as its own group. Absent when the node isn't in canonical shape (a
   *  legacy flat tree keeps its clause inside `condition` until ingest
   *  normalizes it). */
  selectorClauses?: BuilderNode[];
  /** Create/replace (value) or remove (`null`) the clause for a declared selector
   *  field, preserving the canonical shape and the rows group's operator — a new
   *  clause conjoins ABOVE the rows group, never inside it. */
  setSelectorClause?: (field: string, value: unknown | null) => void;
  /** The related model the elements belong to (present for relation lists). */
  relation?: { mapName: string; modelName: string };
  /** Count operators (atLeast/atMost/exactly) → a numeric threshold. */
  count?: { value?: number; set: (n: number | undefined) => void };
  /** Predicate (all/any/none, required) + count (optional) → a sub-condition over the elements. */
  condition?: GroupNode;
  /** Window filter: restrict the elements before the operator applies. */
  filter?: GroupNode;
  /** Drop the filter sub-condition entirely. */
  removeFilter?: () => void;
  /** Gated via checkRuleAgainstLens (validates field + nested condition). */
  valid: boolean;
  remove: () => void;
};

export type BuilderNode = GroupNode | LeafNode | ArrayNode;

type Rec = Record<string, unknown>;
type Ctx = {
  root: Condition;
  maxDepth: number;
  commit: (c: Condition) => void;
  /** The anchor lens + decoration, constant across the tree — used to recognize a
   *  node as a hoisted {@link Decoration} facet and collapse it. */
  anchorLens: Lens;
  decoration?: Decoration;
  surfaceOpts: SurfaceOptions;
};
/** What a node sees: the surface to validate against + its selectable fields. On
 *  descent into an array node's elements, this swaps to the related model. */
type Scope = { lens: Lens; fields: BuilderField[]; decoration?: Decoration };

/**
 * Author-time partition pin. A grouped field (surface `groupBy` axes) narrows its
 * options — AND its `enumValues`, so validity gates on the partition — to the
 * slice selected by conjoined sibling clauses on its axes. Only an `all` block
 * pins (an `any` sibling is not conjunctive); `equals` pins one key, `in` a
 * union, several clauses on one axis intersect; bind/path/unset never pin. The
 * pin derives FROM the semantic clauses, so the picker cannot promise a narrower
 * vocabulary than the rule enforces.
 */
const axisSiblings = (root: Condition, path: RulePath): Condition[] => {
  const out: Condition[] = [];
  for (let d = path.length - 1; d >= 0; d--) {
    const parent = getNode(root, path.slice(0, d));
    if (parent === undefined || !isGroupNode(parent)) break;
    // An `any` parent's own children are disjuncts — they never pin. But clauses
    // conjoined ABOVE the disjunction hold on every branch (e.g. a facet's locked
    // where over a nested any-group), so the walk continues through it.
    if (groupOperatorOf(parent) === 'all')
      out.push(...groupChildrenOf(parent).filter((_, i) => i !== path[d]));
  }
  return out;
};

const pinField = (
  field: BuilderField | undefined,
  siblings: Condition[],
): BuilderField | undefined => {
  if (!field?.groupBy || !field.options) return field;
  const constraints = new Map<number, Set<string>>();
  for (const sibling of siblings) {
    if (typeof sibling !== 'object' || sibling === null) continue;
    const r = sibling as { field?: string; operator?: string; value?: unknown };
    const axis = r.field === undefined ? -1 : field.groupBy.indexOf(r.field);
    if (axis < 0 || r.value === undefined || r.value === '') continue;
    const clause =
      r.operator === 'equals'
        ? new Set([String(r.value)])
        : r.operator === 'in' && Array.isArray(r.value)
          ? new Set(r.value.map(String))
          : undefined;
    if (!clause) continue;
    const prev = constraints.get(axis);
    constraints.set(axis, prev ? new Set([...prev].filter((k) => clause.has(k))) : clause);
  }
  if (constraints.size === 0) return field;
  const options = field.options.filter(
    (o) =>
      o.groups !== undefined &&
      [...constraints].every(([i, keys]) => o.groups?.[i] !== undefined && keys.has(o.groups[i])),
  );
  return { ...field, options, enumValues: options.map((o) => o.value) };
};

const COUNT_OPS = new Set(['atLeast', 'atMost', 'exactly']);
const PREDICATE_OPS = new Set(['all', 'any', 'none']);
type ArrayCat = 'presence' | 'count' | 'predicate';
const arrayCat = (op: string | undefined): ArrayCat =>
  op && COUNT_OPS.has(op) ? 'count' : op && PREDICATE_OPS.has(op) ? 'predicate' : 'presence';

/** The `sum`/`avg` modes the engine's `AggregateMode` supports. `min`/`max` could be
 *  added here if the engine adds them; element *count* is intentionally not a mode —
 *  it is the existing {@link ArrayNode.count} facet on a `count` array operator. */
const AGGREGATE_MODES = ['sum', 'avg'] as const;

/** The threshold comparisons an aggregate rule may use — mirrors the engine's
 *  toPrisma guards (`toPrisma/aggregate.ts`): single-value comparisons + `between`.
 *  `notBetween` is intentionally excluded (the compiler throws on it). */
const AGGREGATE_OPERATORS = [
  'equals',
  'notEquals',
  'lessThan',
  'lessThanEquals',
  'greaterThan',
  'greaterThanEquals',
  'between',
] as const;
const AGGREGATE_OPERATOR_SET = new Set<string>(AGGREGATE_OPERATORS);

/** Author-time windowing keys the engine's `toPrisma()` rejects on an aggregate rule
 *  (`hasWindow`). The element `condition` is NOT windowing — it compiles fine. */
const AGGREGATE_WINDOW_KEYS = ['filter', 'orderBy', 'take', 'skip'] as const;

/**
 * Validate an aggregate rule the way the engine's `toPrisma/aggregate.ts` guards do,
 * plus the check()-only Json carve-out. Returns whether it is authorable at all and
 * whether its numeric target compiles to a Prisma plan.
 *
 * - `field` must terminate at a list (`many`) relation.
 * - `aggregate.field` must exist on the related model and be a numeric scalar
 *   (`compilesToPrisma`) OR a `Json` column (valid-but-flagged, check()-only).
 * - `operator` must be one of {@link AGGREGATE_OPERATORS} (rejects `notBetween`).
 * - no authored windowing ({@link AGGREGATE_WINDOW_KEYS}).
 */
const validateAggregate = (
  rec: Rec,
  relationField: BuilderField | undefined,
  targetField: BuilderField | undefined,
): { ok: boolean; compilesToPrisma: boolean } => {
  const agg = (rec.aggregate ?? {}) as { mode?: string; field?: string };
  const fieldTerminatesAtList =
    relationField?.isList === true && relationField.relation !== undefined;
  const targetExists = targetField !== undefined && targetField.aggregatable === true;
  const targetCompiles = targetField?.compilesToPrisma === true;
  const operatorOk = typeof rec.operator === 'string' && AGGREGATE_OPERATOR_SET.has(rec.operator);
  const modeOk = agg.mode === 'sum' || agg.mode === 'avg';
  const noWindow = AGGREGATE_WINDOW_KEYS.every((k) => rec[k] === undefined);
  const ok = fieldTerminatesAtList && targetExists && operatorOk && modeOk && noWindow;
  return { ok, compilesToPrisma: ok && targetCompiles };
};

/** Scalars, enums, json, and list relations are directly rule-able; a to-one
 *  relation is not (you traverse it via a dotted path or its own array node). */
const selectableFields = (fields: BuilderField[]): BuilderField[] =>
  fields.filter((f) => f.selectable !== false && (f.isList || !f.relation));

const idOf = (n: Condition, index: number): string => {
  const r = n as Rec;
  return (r.__groupId as string) ?? (r.__id as string) ?? String(index);
};

const buildLeaf = (
  node: Condition,
  path: RulePath,
  depth: number,
  ctx: Ctx,
  scope: Scope,
): LeafNode => {
  const id = idOf(node, path.length ? (path[path.length - 1] as number) : 0);
  // A root leaf has no parent array to splice out of — deleting it clears to a blank group.
  const remove = () => ctx.commit(path.length ? removeNode(ctx.root, path) : { all: [] });
  const setLeafKind = (k: 'field' | 'boolean') =>
    ctx.commit(setNode(ctx.root, path, k === 'boolean' ? true : defaultRule(scope.fields)));

  if (typeof node === 'boolean') {
    return {
      kind: 'leaf',
      id,
      path,
      depth,
      leafKind: 'boolean',
      setLeafKind,
      literal: { value: node, set: (v) => ctx.commit(setNode(ctx.root, path, v)) },
      valid: true,
      remove,
    };
  }

  const rec = node as Rec;
  const fieldName = rec.field as string | undefined;
  // Resolve the base field: an exact match, or a Json column carrying a dotted sub-path.
  let field = pinField(
    scope.fields.find((f) => f.name === fieldName),
    axisSiblings(ctx.root, path),
  );
  let baseName = fieldName;
  let subPath: string | undefined;
  if (!field && fieldName?.includes('.')) {
    const head = fieldName.slice(0, fieldName.indexOf('.'));
    const candidate = scope.fields.find((f) => f.name === head);
    if (candidate?.acceptsSubPath) {
      field = candidate;
      baseName = head;
      subPath = fieldName.slice(head.length + 1);
    }
  }
  const operator = (rec.dateOperator ?? rec.operator) as string | undefined;
  const operatorOptions = field
    ? [...field.operators.field, ...field.operators.date].map((o) => ({
        value: o,
        label: o,
      }))
    : [];
  const shape: ValueShape = operator ? valueShapeForOperator(operator as never) : 'none';
  const valueOptions = field?.options
    ? field.options.map((o) => ({
        value: o.value,
        label: field.enumLabels?.[o.value] ?? o.label ?? o.value,
        groups: o.groups,
      }))
    : field?.enumValues?.map((v) => ({
        value: v,
        label: field.enumLabels?.[v] ?? v,
      }));
  const fieldValid = field !== undefined;
  const valueValid = ((): boolean => {
    const allowed = field?.enumValues;
    if (!allowed) return true;
    const v = rec.value;
    const vals = Array.isArray(v) ? v : [v];
    return vals.every((x) => x == null || typeof x !== 'string' || allowed.includes(x));
  })();
  const valueMode: 'value' | 'path' | 'bind' =
    rec.bind !== undefined ? 'bind' : rec.path !== undefined ? 'path' : 'value';
  const leafMatch = scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : undefined;
  const leafHoist: HoistBadge | undefined = leafMatch
    ? { id: facetId(leafMatch), label: leafMatch.label ?? baseName ?? '', icon: leafMatch.icon }
    : undefined;

  return {
    kind: 'leaf',
    id,
    path,
    depth,
    leafKind: 'field',
    setLeafKind,
    field: {
      value: baseName,
      options: selectableFields(scope.fields).map((f) => ({
        value: f.name,
        label: f.label,
        icon: f.icon,
      })),
      set: (name) => {
        const next = scope.fields.find((f) => f.name === name);
        if (next)
          ctx.commit(setNode(ctx.root, path, ruleForField(next, rec.__id as string | undefined)));
      },
      valid: fieldValid,
      acceptsSubPath: field?.acceptsSubPath,
      subPath,
      setSubPath: field?.acceptsSubPath
        ? (sub: string) =>
            ctx.commit(
              setNode(ctx.root, path, {
                ...rec,
                field: sub ? `${baseName}.${sub}` : baseName,
              } as Condition),
            )
        : undefined,
    },
    operator: {
      value: operator,
      options: operatorOptions,
      set: (op) => {
        const isDate = field?.operators.date.includes(op as never) ?? false;
        // A no-operand operator (isEmpty/isNotEmpty) must not inherit the previous
        // operator's operand — validateRule rejects any value on it, leaving the
        // leaf permanently invalid with no visible cause.
        const dropOperand = valueShapeForOperator(op as never) === 'none';
        const { operator: _o, dateOperator: _d, value: v, path: p, bind: b, ...rest } = rec;
        ctx.commit(
          setNode(ctx.root, path, {
            ...rest,
            ...(dropOperand
              ? {}
              : {
                  ...(v !== undefined ? { value: v } : {}),
                  ...(p !== undefined ? { path: p } : {}),
                  ...(b !== undefined ? { bind: b } : {}),
                }),
            [isDate ? 'dateOperator' : 'operator']: op,
          } as Condition),
        );
      },
    },
    value: {
      current: rec.value,
      shape,
      kind: field?.kind,
      options: valueOptions,
      valid: valueValid,
      set: (value) => ctx.commit(setNode(ctx.root, path, { ...rec, value } as Condition)),
      mode: valueMode,
      setMode: (m) => {
        if (m === valueMode) return;
        const { value: _v, path: _p, bind: _b, ...rest } = rec;
        const next =
          m === 'path'
            ? { ...rest, path: (rec.path as string) ?? '' }
            : m === 'bind'
              ? { ...rest, bind: (rec.bind as string) ?? '' }
              : { ...rest, value: rec.value ?? '' };
        ctx.commit(setNode(ctx.root, path, next as Condition));
      },
      path:
        valueMode === 'path'
          ? {
              value: rec.path as string | undefined,
              set: (p) => {
                const { value: _v, bind: _b, ...rest } = rec;
                ctx.commit(setNode(ctx.root, path, { ...rest, path: p } as Condition));
              },
            }
          : undefined,
      bind:
        valueMode === 'bind'
          ? {
              value: rec.bind as string | undefined,
              set: (name) => {
                const { value: _v, path: _p, ...rest } = rec;
                ctx.commit(setNode(ctx.root, path, { ...rest, bind: name } as Condition));
              },
            }
          : undefined,
    },
    hoist: leafHoist,
    atomic: leafMatch && isPreset(leafMatch) ? true : undefined,
    valid: checkRuleAgainstLens(node, scope.lens).ok,
    remove,
  };
};

const buildArray = (
  node: Condition,
  path: RulePath,
  depth: number,
  ctx: Ctx,
  scope: Scope,
): ArrayNode => {
  const rec = node as Rec;
  const fieldName = rec.field as string | undefined;
  const field = scope.fields.find((f) => f.name === fieldName);
  const op = rec.arrayOperator as string | undefined;
  const cat = arrayCat(op);
  const rel = field?.relation;
  const isAggregate = isAggregateNode(node);
  const agg = (rec.aggregate ?? {}) as { mode?: string; field?: string };
  const aggMode: 'sum' | 'avg' = agg.mode === 'avg' ? 'avg' : 'sum';

  // A hoisted collection facet: recognize the node so it renders as its named
  // entry (fixed leading `where` hidden, operator hidden-editable, leaf retyped).
  // Aggregate rules are never facets — skip the match (an aggregate rule also has
  // no `arrayOperator`, which the whereless-prefix heuristic would otherwise catch).
  const matchedFacet =
    !isAggregate && scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : undefined;
  const overrideLeaf = matchedFacet
    ? facetElementLeaf(scope.lens, matchedFacet, ctx.surfaceOpts)
    : undefined;

  // Elements belong to the related model → author condition/filter against its surface.
  const relScope: Scope = rel
    ? (() => {
        const relLens = exposedSurface(
          createLens({
            maps: scope.lens.maps,
            mapName: rel.mapName,
            model: rel.modelName,
          }),
        );
        const relFields = relabelRelations(
          describeModelFields(relLens, rel.mapName, rel.modelName),
          ctx.decoration,
        );
        const fields = overrideLeaf
          ? relFields.map((f) => (f.name === overrideLeaf.name ? { ...f, ...overrideLeaf } : f))
          : relFields;
        const relDecoration = scopedDecoration(ctx.decoration, rel.mapName, rel.modelName);
        if (!relDecoration) return { lens: relLens, fields };
        // The scope's own facets lead its picker, exactly like the anchor root.
        const hoisted = describeFacets(relLens, relDecoration, ctx.surfaceOpts);
        const consumed = consumedTopFields(relDecoration);
        return {
          lens: relLens,
          fields: [
            ...hoisted,
            ...(consumed.size ? fields.filter((f) => !consumed.has(f.name)) : fields),
          ],
          decoration: relDecoration,
        };
      })()
    : scope;

  // A nested condition/filter is a sub-tree: build it over its own root, and on
  // every commit splice the whole sub-condition back under the array rule's key.
  let selectorClauseNodes: BuilderNode[] | undefined;
  const buildSub = (key: 'condition' | 'filter'): GroupNode => {
    const subRoot = asGroupRoot((rec[key] as Condition | undefined) ?? { all: [] });
    // Facets apply in element conditions only — never filters or aggregate windows.
    const subScope =
      key === 'condition' && !isAggregate ? relScope : { ...relScope, decoration: undefined };
    const subCtx: Ctx = {
      ...ctx,
      root: subRoot,
      commit: (next) => ctx.commit(setNode(ctx.root, path, { ...rec, [key]: next } as Condition)),
    };
    // Canonical facet shape (identity leading + one trailing user-rows group): the
    // rows group IS the facet's editable surface — its toggle, paths, and adds are
    // real, and the identity is simply not part of the view. Any other matched
    // shape renders raw under the badge: nothing is hidden, so a toggle honestly
    // changes what the user sees — and breaks the bind — instead of silently
    // absorbing a hidden clause.
    if (key === 'condition' && matchedFacet) {
      // The identity block is the fixed `where` prefix plus the selector clauses
      // right after it — a selector-backed facet (survey question, badge name)
      // has user-picked identity the `where` machinery can't know about.
      const lead = leadingIdentityCount(scope.lens, matchedFacet, node);
      const kids = (subRoot as { all?: Condition[] }).all ?? [];
      const tail = kids[lead];
      if (lead > 0 && kids.length === lead + 1 && tail && isGroupNode(tail)) {
        // Selector clauses get real builder nodes even though they sit OUTSIDE
        // the rows group — the renderer's selector dropdowns read and write
        // through them (value/options; a complex OR-block selector comes back as
        // a group), while the toggle below can only ever re-key the rows group.
        // Their remove routes through the write seam so both removal gestures
        // land on the same shape (unwrap included).
        const whereLead = leadingWhereCount(matchedFacet, node);
        const clauseSlice = kids.slice(whereLead, lead);
        selectorClauseNodes = clauseSlice.length
          ? clauseSlice.map((clause, i) => {
              const built = buildNode(clause, [whereLead + i], depth + 1, subCtx, subScope);
              // An OR-block clause carries its field on its (uniform) children.
              const clauseField =
                (clause as { field?: string }).field ??
                (groupChildrenOf(clause)[0] as { field?: string } | undefined)?.field;
              return clauseField
                ? {
                    ...built,
                    remove: () =>
                      subCtx.commit(writeSelectorClause(matchedFacet, subRoot, clauseField, null)),
                  }
                : built;
            })
          : undefined;
        // A condition surface is never removable (matching the sub-root contract):
        // without the override, the rows group's own remove would leak here and
        // delete every user row in one gesture, stranding the hidden identity.
        return {
          ...buildGroup(tail, [lead], depth + 1, subCtx, subScope),
          // The rows group is the outer facet's surface: not removable, never re-badged.
          remove: undefined,
          hoist: undefined,
          atomic: undefined,
          facetMode: undefined,
          selectors: undefined,
          selectorClauses: undefined,
          setSelectorClause: undefined,
        };
      }
    }
    return buildGroup(subRoot, [], depth + 1, subCtx, subScope);
  };

  // Aggregate target: the numeric scalar (or check()-only Json) on the RELATED model
  // that `sum`/`avg` reduces. Offered only when the element relation resolves.
  const aggTargetFields = rel ? relScope.fields.filter((f) => f.aggregatable) : [];
  const aggTargetField = rel ? relScope.fields.find((f) => f.name === agg.field) : undefined;
  const aggregateValidation = isAggregate
    ? validateAggregate(rec, field, aggTargetField)
    : undefined;

  // Built ahead of the node literal: `buildSub('condition')` is what fills
  // `selectorClauseNodes`, and the literal reads that capture further up.
  const conditionNode =
    rel && (isAggregate || cat === 'predicate' || cat === 'count')
      ? buildSub('condition')
      : undefined;
  const filterNode = rel && !isAggregate ? buildSub('filter') : undefined;

  // The selector seam exists only where every part of it is real: the facet's
  // selectors must apply here ({@link selectorsApply} — single-hop, non-preset),
  // and the node must actually render a condition surface. A presence node
  // (empty/notEmpty) has no condition — offering a write into a subtree the
  // engine ignores and the builder never shows would hide dead data in the rule.
  const selectorFacet =
    matchedFacet?.selectors?.length &&
    rel &&
    !isAggregate &&
    conditionNode !== undefined &&
    selectorsApply(scope.lens, matchedFacet)
      ? matchedFacet
      : undefined;

  return {
    kind: 'array',
    id: idOf(node, path.length ? (path[path.length - 1] as number) : 0),
    path,
    depth,
    relation: rel,
    field: {
      value: fieldName,
      options: selectableFields(scope.fields).map((f) => ({
        value: f.name,
        label: f.label,
        icon: f.icon,
      })),
      set: (name) => {
        const next = scope.fields.find((f) => f.name === name);
        if (!next) return;
        const id = rec.__id ? { __id: rec.__id as string } : {};
        // In aggregate mode, re-pointing at another list relation keeps the aggregate
        // (mode/operator/value preserved) but clears the target field — its related
        // model changed. A non-list target falls back to the ordinary rule shape.
        if (isAggregate && next.isList && next.relation) {
          ctx.commit(
            setNode(ctx.root, path, {
              field: name,
              aggregate: { mode: aggMode },
              operator: (rec.operator as string) ?? 'greaterThan',
              ...(rec.value !== undefined ? { value: rec.value } : {}),
              ...id,
            } as Condition),
          );
          return;
        }
        ctx.commit(setNode(ctx.root, path, ruleForField(next, rec.__id as string | undefined)));
      },
      valid: field !== undefined,
    },
    hoist: matchedFacet
      ? {
          id: facetId(matchedFacet),
          label: matchedFacet.label ?? fieldName ?? '',
          icon: matchedFacet.icon,
        }
      : undefined,
    selectors: selectorFacet?.selectors,
    selectorClauses: selectorFacet ? selectorClauseNodes : undefined,
    setSelectorClause: selectorFacet
      ? (selectorField, value) => {
          if (!selectorFacet.selectors?.some((s) => s.field === selectorField)) return;
          const next = writeSelectorClause(
            selectorFacet,
            rec.condition as Condition | undefined,
            selectorField,
            value,
          );
          ctx.commit(setNode(ctx.root, path, { ...rec, condition: next } as Condition));
        }
      : undefined,
    facetMode: facetModeControl(matchedFacet, rec, path, ctx),
    atomic: matchedFacet && isPreset(matchedFacet) ? true : undefined,
    // Element-mode operator: absent on an aggregate node (it carries `aggregate`).
    arrayOperator: isAggregate
      ? undefined
      : {
          value: op,
          options: (field?.operators.array ?? []).map((o) => ({
            value: o,
            label: o,
          })),
          hidden: matchedFacet ? true : undefined,
          set: (nextOp) => {
            const nextCat = arrayCat(nextOp);
            const { count, condition, ...restRec } = rec;
            const out: Rec = { ...restRec, arrayOperator: nextOp };
            if (nextCat !== 'presence' && condition !== undefined) out.condition = condition;
            if (nextCat === 'count' && count !== undefined) out.count = count;
            ctx.commit(setNode(ctx.root, path, out as Condition));
          },
        },
    // Aggregate mode: sum/avg over the related list → a threshold comparison. The
    // element window is authored via `condition` (below), not a separate control.
    aggregate: isAggregate
      ? {
          mode: aggMode,
          modeOptions: AGGREGATE_MODES.map((m) => ({ value: m, label: m })),
          setMode: (m) =>
            ctx.commit(
              setNode(ctx.root, path, { ...rec, aggregate: { ...agg, mode: m } } as Condition),
            ),
          field: {
            value: agg.field,
            options: aggTargetFields.map((f) => ({
              value: f.name,
              label: f.label,
              icon: f.icon,
              compilesToPrisma: f.compilesToPrisma,
            })),
            set: (name) =>
              ctx.commit(
                setNode(ctx.root, path, {
                  ...rec,
                  aggregate: { ...agg, field: name },
                } as Condition),
              ),
            valid: aggTargetField?.aggregatable === true,
            compilesToPrisma: aggTargetField?.compilesToPrisma,
          },
          operator: {
            value: rec.operator as string | undefined,
            options: AGGREGATE_OPERATORS.map((o) => ({ value: o, label: o })),
            set: (nextOp) =>
              ctx.commit(setNode(ctx.root, path, { ...rec, operator: nextOp } as Condition)),
          },
          value: {
            current: rec.value as number | [number, number] | undefined,
            shape: rec.operator ? valueShapeForOperator(rec.operator as never) : 'none',
            set: (v) => ctx.commit(setNode(ctx.root, path, { ...rec, value: v } as Condition)),
          },
        }
      : undefined,
    count:
      !isAggregate && cat === 'count'
        ? {
            value: rec.count as number | undefined,
            set: (n) => ctx.commit(setNode(ctx.root, path, { ...rec, count: n } as Condition)),
          }
        : undefined,
    // Element predicate (element mode) OR aggregate window (aggregate mode) — both
    // ride the same `condition` sub-builder scoped to the related model.
    condition: conditionNode,
    // `filter` is authored windowing — offered on element rules, never on an
    // aggregate (toPrisma() rejects windowing on aggregates).
    filter: filterNode,
    removeFilter:
      rel && !isAggregate
        ? () => {
            const { filter: _f, ...restRec } = rec;
            ctx.commit(setNode(ctx.root, path, restRec as Condition));
          }
        : undefined,
    valid: checkRuleAgainstLens(node, scope.lens).ok && (aggregateValidation?.ok ?? true),
    // A root array rule has no parent to splice out of — deleting it clears to a
    // blank group, mirroring the leaf-root behavior.
    remove: () => ctx.commit(path.length ? removeNode(ctx.root, path) : { all: [] }),
  };
};

const buildGroup = (
  node: Condition,
  path: RulePath,
  depth: number,
  ctx: Ctx,
  scope: Scope,
): GroupNode => {
  const matched = scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : undefined;
  const preset = matched !== undefined && isPreset(matched);
  // A branch is a to-one relation surfaced as a scoped group, and always a *nested*
  // group — gating on `path.length` stops the whereless prefix heuristic from
  // capturing the root (and swapping its picker to the branch scope). A preset,
  // by contrast, is recognized anywhere including the root.
  const branchFacet = matched && !preset && path.length > 0 ? matched : undefined;
  const branch = branchFacet && facetBranchScope(ctx.anchorLens, branchFacet, ctx.surfaceOpts);
  const groupScope: Scope = branch
    ? { lens: scope.lens, fields: relabelRelations(branch.fields, ctx.decoration) }
    : scope;
  // The facet actually applied to this group: a preset (anywhere) or a branch (nested).
  const groupFacet = preset ? matched : branchFacet;
  const groupHoist: HoistBadge | undefined = groupFacet
    ? {
        id: facetId(groupFacet),
        label: groupFacet.label ?? branch?.prefix ?? '',
        icon: groupFacet.icon,
      }
    : undefined;

  // The root/anchor group can be retagged via `labels.models`; a facet shows its name.
  const groupLabel =
    groupHoist?.label ??
    (path.length === 0
      ? modelDecor(ctx.decoration, scope.lens.mapName, scope.lens.model).label
      : undefined);

  // Canonical branch shape (identity leading + one trailing user-rows group): the
  // rows group IS the facet's surface — built at its real path with the facet's
  // chrome; the identity is not part of the view, and removing the facet removes
  // the whole unit. Any other matched shape renders raw under the badge: nothing
  // hidden, so a toggle honestly changes what the user sees — and breaks the
  // bind — instead of silently absorbing a hidden clause.
  const identityLead =
    branchFacet && branch ? leadingIdentityCount(scope.lens, branchFacet, node) : 0;
  const kids = groupChildrenOf(node);
  const rowsTail = kids[identityLead];
  // Branch identity is conjoined at the top of the group itself, so the selector
  // write seam targets the group directly.
  const selectorGroupFacet =
    branchFacet?.selectors?.length && branch && selectorsApply(scope.lens, branchFacet)
      ? branchFacet
      : undefined;
  const setGroupSelectorClause = selectorGroupFacet
    ? (selectorField: string, value: unknown | null) => {
        if (!selectorGroupFacet.selectors?.some((s) => s.field === selectorField)) return;
        ctx.commit(
          setNode(
            ctx.root,
            path,
            writeSelectorClause(selectorGroupFacet, node, selectorField, value),
          ),
        );
      }
    : undefined;
  if (identityLead > 0 && kids.length === identityLead + 1 && rowsTail && isGroupNode(rowsTail)) {
    // Selector clauses get real builder nodes even though they sit outside the
    // rows surface (see the collection collapse in buildArray) — dropdowns read
    // and write through them while the toggle can only re-key the rows group.
    // Their remove routes through the write seam so both removal gestures land
    // on the same shape.
    const whereLead = branchFacet ? leadingWhereCount(branchFacet, node) : 0;
    const inner = buildGroup(rowsTail, [...path, identityLead], depth, ctx, groupScope);
    return {
      ...inner,
      label: groupLabel ?? inner.label,
      hoist: groupHoist,
      selectors: selectorGroupFacet?.selectors,
      selectorClauses:
        selectorGroupFacet && identityLead > whereLead
          ? kids.slice(whereLead, identityLead).map((clause, i) => {
              const built = buildNode(clause, [...path, whereLead + i], depth, ctx, groupScope);
              const clauseField =
                (clause as { field?: string }).field ??
                (groupChildrenOf(clause)[0] as { field?: string } | undefined)?.field;
              return clauseField
                ? { ...built, remove: () => setGroupSelectorClause?.(clauseField, null) }
                : built;
            })
          : undefined,
      setSelectorClause: setGroupSelectorClause,
      atomic: undefined,
      facetMode: facetModeControl(groupFacet, node as Rec, path, ctx),
      remove: path.length ? () => ctx.commit(removeNode(ctx.root, path)) : undefined,
    };
  }

  return {
    kind: 'group',
    id: idOf(node, path.length ? (path[path.length - 1] as number) : 0),
    path,
    depth,
    label: groupLabel,
    operator: {
      value: groupOperatorOf(node),
      set: (op) => ctx.commit(setNode(ctx.root, path, switchGroupOperator(node, op))),
    },
    children: groupChildrenOf(node).map((child, i) =>
      buildNode(child, [...path, i], depth + 1, ctx, groupScope),
    ),
    addRule: () => ctx.commit(addRule(ctx.root, path, defaultRule(groupScope.fields))),
    addGroup: () => ctx.commit(addRule(ctx.root, path, { all: [] })),
    canAddGroup: depth < ctx.maxDepth,
    hoist: groupHoist,
    atomic: preset ? true : undefined,
    facetMode: facetModeControl(groupFacet, node as Rec, path, ctx),
    selectors: selectorGroupFacet?.selectors,
    setSelectorClause: setGroupSelectorClause,
    remove: path.length ? () => ctx.commit(removeNode(ctx.root, path)) : undefined,
  };
};

/**
 * The faceted ⇄ raw toggle — the session escape hatch from facet capture. `raw`
 * writes `__facetId: null`: recognition suspends, hoist/lock drop, and the
 * identity rows render as plain editable children. `faceted` deletes the key,
 * reopening the node to search — recognition resumes iff the rows still form
 * the facet. Offered whenever a facet governs the node or a detach is active.
 */
const facetModeControl = (
  matched: Facet | undefined,
  rec: Rec,
  path: RulePath,
  ctx: Ctx,
): FacetModeControl | undefined => {
  const detached = rec.__facetId === null;
  if (!matched && !detached) return undefined;
  return {
    value: detached ? 'raw' : 'faceted',
    set: (mode) => {
      if ((mode === 'raw') === detached) return;
      const { __facetId: _f, ...restRec } = rec;
      ctx.commit(
        setNode(
          ctx.root,
          path,
          (mode === 'raw' ? { ...rec, __facetId: null } : restRec) as Condition,
        ),
      );
    },
  };
};

const buildNode = (
  node: Condition,
  path: RulePath,
  depth: number,
  ctx: Ctx,
  scope: Scope,
): BuilderNode =>
  isGroupNode(node)
    ? buildGroup(node, path, depth, ctx, scope)
    : isArrayNode(node) || isAggregateNode(node)
      ? buildArray(node, path, depth, ctx, scope)
      : buildLeaf(node, path, depth, ctx, scope);

/** Normalize a (sub-)condition to a group so it has a compound to add into. Used for the array
 *  node's nested condition/filter sub-trees, which are always groups over the related elements. */
export const asGroupRoot = (cond: Condition | undefined): Condition =>
  cond !== undefined && isGroupNode(cond) ? cond : { all: cond !== undefined ? [cond] : [] };

/** The root is the condition itself — never synthetically wrapped. Only an absent condition
 *  becomes `empty` — a blank group by default (a first-class, add-into-able container), or a
 *  caller-supplied scaffold; a bare leaf or `true`/`false` stays bare. Absence is `undefined`
 *  only: a `null` from a DB row is the caller's to normalize at its own boundary. */
export const asRoot = (cond: Condition | undefined, empty: Condition = { all: [] }): Condition =>
  cond === undefined ? empty : cond;

/**
 * Build the headless descriptor tree from a condition + composed lens. The root is whatever the
 * condition is — a group, a field leaf, an array rule, or a `true`/`false` literal leaf — never
 * force-wrapped. Pure: every action computes the next condition and calls `commit`.
 */
export const buildRoot = (
  root: Condition,
  lens: Lens,
  fields: BuilderField[],
  maxDepth: number,
  commit: (next: Condition) => void,
  opts: { decoration?: Decoration; surfaceOpts?: SurfaceOptions } = {},
): BuilderNode => {
  const normalized = asRoot(root);
  const ctx: Ctx = {
    root: normalized,
    maxDepth,
    commit,
    anchorLens: lens,
    decoration: opts.decoration,
    surfaceOpts: opts.surfaceOpts ?? {},
  };
  return buildNode(normalized, [], 0, ctx, { lens, fields, decoration: opts.decoration });
};
