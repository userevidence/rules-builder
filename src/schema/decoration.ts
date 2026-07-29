import {
  type ArrayOperator,
  type Condition,
  checkRuleAgainstLens,
  type FieldKind,
  type Lens,
} from '@inixiative/json-rules';
import { useEffect, useMemo } from 'react';
import { ruleForField } from '../builder/nodes';
import {
  type BuilderField,
  describeModelFields,
  operatorsForKind,
  relationTarget,
  type SurfaceOptions,
} from './surface';

export type Decor = { label?: string; icon?: string };

/**
 * A named entry moved up to the builder's root selector. Two forms:
 *
 * **Path facet** — a pre-traversed entry point. `path` is dotted from the lens
 * anchor and may traverse any number of to-one relations (including `map:Model`
 * bridges). Its shape decides the kind:
 *  - reaches a scalar/enum through only to-one hops → a **leaf**: `{ field: path }`.
 *  - crosses a *list* relation → a **collection**: a top-level array node (a
 *    scalar operator over a list path silently mis-evaluates, so it must be a node).
 *
 * Plus, on a path facet:
 *  - `where` — **fixed**, non-editable, the facet's *identity*. It sits on the model
 *    its fields reference (where the path travels to), as the leading condition(s),
 *    and it is the only thing rehydration reverse-matches on. For EAV this is the
 *    `key = 'nps'` that makes the list read as one field "NPS".
 *  - `defaultWhere` — the **array-traversal layer**: one {@link ArrayOperator} per
 *    array boundary the path crosses to reach that model. Its length must equal the
 *    path's array-traversal count ({@link validateDecoration} enforces it); each
 *    defaults to `any` (the "contains" semantic). Editable defaults, not identity.
 *  - `kind` overrides an untyped `value` column.
 *
 * **Preset facet** — `condition` instead of `path`: a named alias for a *complete*
 * pre-authored `Condition` (e.g. "Mature" = arr > 1M AND employees > 500 AND …).
 * Selecting it drops the whole condition in as one **atomic** node — no field,
 * operator, or value pickers; it just *is* a rule. A saved node equal to the
 * condition collapses back to the name.
 *
 * Purely presentational — the emitted rule is exactly what the engine runs.
 */
export type Facet = {
  path?: string;
  where?: Condition;
  defaultWhere?: ArrayOperator[];
  kind?: FieldKind;
  /** Declared inner selector rows (e.g. the field picker inside a source
   *  container): ordinary editable conditions on these fields that a renderer
   *  draws as dedicated dropdowns ("Field: [Any ▾]") instead of hardcoding the
   *  paths. Surfaced verbatim on a matched node. Options for the row come from
   *  the field's own source; a grouped value leaf pins off these siblings. */
  selectors?: { field: string; label?: string; anyLabel?: string }[];
  /** A preset: the complete pre-authored condition this facet aliases. When set,
   *  `path` and the traversal fields are ignored. */
  condition?: Condition;
} & Decor;

/** A preset facet aliases a whole pre-authored condition (atomic; no pickers). */
export const isPreset = (facet: Facet): boolean => facet.condition !== undefined;

/**
 * A display decoration over a lens: hoisted facets plus structural/path
 * relabeling. It renames and reorders what the builder *offers*; it never changes
 * what the lens admits or what the engine runs. Validate it with
 * {@link validateDecoration} so its facets can never collide on rehydration.
 */
export type Decoration = {
  facets: Facet[];
  labels?: {
    /** map decor — `"salesforce"`. (Reserved.) */
    maps?: Record<string, Decor>;
    /** model decor, keyed `map:Model` or `Model` — retags the **root/anchor**
     *  (`GroupNode.label`) and any relation field by its target model. */
    models?: Record<string, Decor>;
    /** field decor, keyed by full path from the anchor, or structurally
     *  (`map:Model.field` / `Model.field`). Path key wins over structural. */
    fields?: Record<string, Decor>;
    /** enum/sourced value decor, keyed like `fields` → (value → decor). */
    values?: Record<string, Record<string, Decor>>;
  };
};

type LeafResolved = { kind: 'leaf'; mapName: string; modelName: string; field: string };
type CollectionResolved = {
  kind: 'collection';
  listOwner: { mapName: string; modelName: string };
  listField: string;
  listPath: string;
  target: { mapName: string; modelName: string };
  elementLeaf?: string;
};
type BranchResolved = {
  kind: 'branch';
  prefix: string;
  target: { mapName: string; modelName: string };
};
type Resolved = LeafResolved | CollectionResolved | BranchResolved;

const RELATION_KINDS = new Set(['object', 'bridge']);

/**
 * Classify a facet path against the lens graph. To-one hops are traversed freely;
 * the first *list* relation makes it a collection anchored there, with the
 * remainder as the element leaf. Returns `undefined` — the facet is dropped — for
 * an unresolvable path or a bare relation leaf (not a value).
 */
const resolvePath = (lens: Lens, path: string | undefined): Resolved | undefined => {
  if (!path) return undefined;
  const segments = path.split('.');
  let mapName = lens.mapName;
  let modelName = lens.model;
  for (let i = 0; i < segments.length; i++) {
    const entry = lens.maps[mapName]?.models[modelName]?.fields[segments[i]];
    if (!entry) return undefined;
    if (entry.isList) {
      const target = relationTarget(entry, mapName);
      if (!target) return undefined;
      return {
        kind: 'collection',
        listOwner: { mapName, modelName },
        listField: segments[i],
        listPath: segments.slice(0, i + 1).join('.'),
        target,
        elementLeaf: segments.slice(i + 1).join('.') || undefined,
      };
    }
    if (i === segments.length - 1) {
      if (RELATION_KINDS.has(entry.kind)) {
        // a bare to-one relation → a branch (a scoped group of its `prefix.field` conditions).
        const target = relationTarget(entry, mapName);
        return target ? { kind: 'branch', prefix: path, target } : undefined;
      }
      return { kind: 'leaf', mapName, modelName, field: segments[i] };
    }
    const target = relationTarget(entry, mapName);
    if (!target) return undefined;
    mapName = target.mapName;
    modelName = target.modelName;
  }
  return undefined;
};

/** A `where` may be a single condition or an `all` group — normalize to the flat
 *  list of leading conditions it contributes. */
export const whereConditions = (where: Condition | undefined): Condition[] => {
  if (!where) return [];
  const all = (where as { all?: Condition[] }).all;
  return Array.isArray(all) ? all : [where];
};

const pickDecor = (dict: Record<string, Decor> | undefined, ...keys: string[]): Decor => {
  if (dict) for (const key of keys) if (dict[key]) return dict[key];
  return {};
};

/** The label/icon for a model (or bridge target), keyed `map:Model` or `Model`.
 *  This is how the **root/anchor** and any relation get retagged — a to-one or
 *  list field reads as its target's friendly name. */
export const modelDecor = (
  decoration: Decoration | undefined,
  mapName: string,
  modelName: string,
): Decor => pickDecor(decoration?.labels?.models, `${mapName}:${modelName}`, modelName);

/** Retag relation fields (to-one and list) by their target model's `labels.models`
 *  entry, so a field surface reads in customer terms wherever it's shown. */
export const relabelRelations = (
  fields: BuilderField[],
  decoration: Decoration | undefined,
): BuilderField[] => {
  if (!decoration?.labels?.models) return fields;
  return fields.map((f) => {
    if (!f.relation) return f;
    const decor = modelDecor(decoration, f.relation.mapName, f.relation.modelName);
    return decor.label ? { ...f, label: decor.label, icon: f.icon ?? decor.icon } : f;
  });
};

/** A stable id — the selector option value and React key. Only the *fixed* `where`
 *  folds in (it is identity); `defaultWhere` is editable, so it never does. The
 *  `where` is canonicalized (like every comparison here) so key order doesn't
 *  yield different ids for structurally identical wheres. */
export const facetId = (facet: Facet): string => {
  if (facet.condition !== undefined) return `#preset:${JSON.stringify(canonical(facet.condition))}`;
  return facet.where
    ? `${facet.path}#${JSON.stringify(canonical(facet.where))}`
    : (facet.path ?? '');
};

// A rehydrated node carries metadata the authored `where` never has (coerceType
// from stampCoercions, _id/_groupId from the tree). Strip it and sort keys so the
// leading-block comparison is order- and coercion-insensitive.
const META = new Set(['coerceType', '_id', '_groupId']);
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort())
      if (!META.has(key)) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

const sameConditions = (a: Condition[], b: Condition[]): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** True when `lead` is a leading prefix of `conds` (both canonicalized). An empty
 *  `lead` (a facet with no fixed `where`) is a prefix of everything — which is why
 *  a no-`where` facet collides with any `where` facet on the same target. */
const isLeadingPrefix = (lead: Condition[], conds: Condition[]): boolean =>
  lead.length <= conds.length && sameConditions(lead, conds.slice(0, lead.length));

/** Every `lead` clause appears somewhere in `conds` (order-tolerant identity).
 *  Multiset containment over canonicalized clauses — an AI- or hand-authored
 *  block that carries the identity clauses in any order still matches. */
const isSubset = (lead: Condition[], conds: Condition[]): boolean => {
  if (lead.length > conds.length) return false;
  const pool = conds.map((c) => JSON.stringify(canonical(c)));
  for (const clause of lead) {
    const key = JSON.stringify(canonical(clause));
    const at = pool.indexOf(key);
    if (at < 0) return false;
    pool.splice(at, 1);
  }
  return true;
};

const buildLeafField = (
  lens: Lens,
  facet: Facet,
  resolved: LeafResolved,
  fieldDecor: Record<string, Decor> | undefined,
  opts: SurfaceOptions,
): BuilderField | undefined => {
  if (facet.path === undefined) return undefined;
  const base = describeModelFields(lens, resolved.mapName, resolved.modelName, opts).find(
    (f) => f.name === resolved.field,
  );
  if (!base) return undefined;
  const decor = pickDecor(
    fieldDecor,
    facet.path,
    `${resolved.mapName}:${resolved.modelName}.${resolved.field}`,
    `${resolved.modelName}.${resolved.field}`,
  );
  return {
    ...base,
    name: facet.path,
    label: facet.label ?? decor.label ?? base.label,
    icon: facet.icon ?? decor.icon,
  };
};

/** The element leaf's descriptor with any `kind` override applied — used to seed
 *  the value rule and (on rehydration) to retype the element surface. */
export const facetElementLeaf = (
  lens: Lens,
  facet: Facet,
  opts: SurfaceOptions = {},
): BuilderField | undefined => {
  const resolved = resolvePath(lens, facet.path);
  if (resolved?.kind !== 'collection' || !resolved.elementLeaf) return undefined;
  const leaf = describeModelFields(
    lens,
    resolved.target.mapName,
    resolved.target.modelName,
    opts,
  ).find((f) => f.name === resolved.elementLeaf);
  if (!leaf) return undefined;
  return facet.kind
    ? { ...leaf, kind: facet.kind, operators: operatorsForKind(facet.kind, opts.targets) }
    : leaf;
};

/** How many of a matched `node`'s leading conditions are the facet's fixed `where`
 *  (0 when it isn't at this node — e.g. an upstream traversal node whose `where`
 *  lives deeper). A renderer hides exactly this many. Reads an array node's
 *  `condition.all` or a group's own `all`/`any`. */
export const leadingWhereCount = (facet: Facet, node: Condition): number => {
  const lead = whereConditions(facet.where);
  if (lead.length === 0) return 0;
  const rec = node as { condition?: Condition; all?: Condition[]; any?: Condition[] };
  const conds = rec.condition
    ? ((rec.condition as { all?: Condition[] }).all ?? [])
    : (rec.all ?? rec.any ?? []);
  return isLeadingPrefix(lead, conds) ? lead.length : 0;
};

/**
 * The field surface a branch facet's group is authored against, each re-`name`d to
 * its `prefix.…` dotted path so a leaf emits the real path. It walks the branch
 * model's exposed surface — the lens already fixes the depth (a narrowing decides
 * what's reachable), so there is no cap here; a per-chain `seen` guard terminates
 * on recursive schemas, exactly as `exposedSurface` does. It reaches:
 *  - scalar/enum values of the branch model and its nested to-one relations
 *    (`account.owner.email`) — the nested-branch case as flattened deep paths;
 *  - **list relations** at each level, kept selectable so they build a nested array
 *    node (`account.contracts …`) rather than a broken flat leaf.
 */
export const branchFields = (
  lens: Lens,
  prefix: string,
  target: { mapName: string; modelName: string },
  opts: SurfaceOptions = {},
): BuilderField[] => {
  const out: BuilderField[] = [];
  const walk = (mapName: string, modelName: string, at: string, seen: Set<string>) => {
    const key = `${mapName}:${modelName}`;
    if (seen.has(key)) return;
    const nextSeen = new Set([...seen, key]);
    for (const f of describeModelFields(lens, mapName, modelName, opts)) {
      const name = `${at}.${f.name}`;
      if (f.isList) {
        out.push({ ...f, name }); // a list → an array node, never descended flat
      } else if (f.relation) {
        walk(f.relation.mapName, f.relation.modelName, name, nextSeen);
      } else {
        out.push({ ...f, name });
      }
    }
  };
  walk(target.mapName, target.modelName, prefix, new Set());
  return out;
};

/** The scope a branch facet's group is authored against — its `prefix` and the
 *  prefixed field surface. `undefined` when the facet isn't a branch. */
export const facetBranchScope = (
  lens: Lens,
  facet: Facet,
  opts: SurfaceOptions = {},
): { prefix: string; fields: BuilderField[] } | undefined => {
  const resolved = resolvePath(lens, facet.path);
  if (resolved?.kind !== 'branch') return undefined;
  return {
    prefix: resolved.prefix,
    fields: branchFields(lens, resolved.prefix, resolved.target, opts),
  };
};

const branchSeed = (
  lens: Lens,
  facet: Facet,
  resolved: BranchResolved,
  opts: SurfaceOptions,
): Condition => {
  const [first] = branchFields(lens, resolved.prefix, resolved.target, opts);
  // `defaultWhere` is array-only (see its doc) — a branch takes only its fixed
  // identity `where` plus a first blank leaf.
  const all = [...whereConditions(facet.where), ...(first ? [ruleForField(first)] : [])];
  return { all } as Condition;
};

/** Whether a path from `(mapName, modelName)` crosses a list relation. */
const pathHasList = (
  lens: Lens,
  mapName: string,
  modelName: string,
  segments: string[],
): boolean => {
  let m = mapName;
  let mod = modelName;
  for (const seg of segments) {
    const entry = lens.maps[m]?.models[mod]?.fields[seg];
    if (!entry) return false;
    if (entry.isList) return true;
    const target = relationTarget(entry, m);
    if (!target) return false;
    m = target.mapName;
    mod = target.modelName;
  }
  return false;
};

/** The value rule at the end of a to-one-only path within an element model. */
const leafRuleAt = (
  lens: Lens,
  mapName: string,
  modelName: string,
  segments: string[],
  kind: FieldKind | undefined,
  opts: SurfaceOptions,
): Condition | null => {
  let m = mapName;
  let mod = modelName;
  for (let i = 0; i < segments.length - 1; i++) {
    const entry = lens.maps[m]?.models[mod]?.fields[segments[i]];
    const target = entry && relationTarget(entry, m);
    if (!target) return null;
    m = target.mapName;
    mod = target.modelName;
  }
  const found = describeModelFields(lens, m, mod, opts).find(
    (f) => f.name === segments[segments.length - 1],
  );
  if (!found) return null;
  const leaf: BuilderField = {
    ...found,
    name: segments.join('.'),
    ...(kind ? { kind, operators: operatorsForKind(kind, opts.targets) } : {}),
  };
  return ruleForField(leaf);
};

/** How many array boundaries a path crosses — the number of traversal operators
 *  it needs (see {@link validateDecoration}). */
export const arrayTraversalCount = (lens: Lens, path: string | undefined): number => {
  if (!path) return 0;
  const segments = path.split('.');
  let m = lens.mapName;
  let mod = lens.model;
  let count = 0;
  for (const seg of segments) {
    const entry = lens.maps[m]?.models[mod]?.fields[seg];
    if (!entry) break;
    const target = relationTarget(entry, m);
    if (entry.isList) count++;
    if (!target) break;
    m = target.mapName;
    mod = target.modelName;
  }
  return count;
};

/**
 * Build the array-node structure for a collection path. Every array boundary the
 * path crosses becomes an array node whose operator is the next entry of `ops`
 * (defaulting to `any`) — one operator per traversal. The `where` and value leaf
 * sit at the innermost element, the model the path travels to. So
 * `orders.customFields.value` with `where key=nps` and `ops [any, any]` seeds
 * `orders any ( customFields any ( key=nps AND value ) )`.
 */
const buildCollection = (
  lens: Lens,
  mapName: string,
  modelName: string,
  segments: string[],
  ops: ArrayOperator[],
  opIndex: { i: number },
  where: Condition | undefined,
  kind: FieldKind | undefined,
  opts: SurfaceOptions,
): Condition | null => {
  let m = mapName;
  let mod = modelName;
  for (let i = 0; i < segments.length; i++) {
    const entry = lens.maps[m]?.models[mod]?.fields[segments[i]];
    if (!entry) return null;
    if (entry.isList) {
      const target = relationTarget(entry, m);
      if (!target) return null;
      const listField = segments.slice(0, i + 1).join('.');
      const rest = segments.slice(i + 1);
      const op = ops[opIndex.i++] ?? 'any';
      if (pathHasList(lens, target.mapName, target.modelName, rest)) {
        const inner = buildCollection(
          lens,
          target.mapName,
          target.modelName,
          rest,
          ops,
          opIndex,
          where,
          kind,
          opts,
        );
        return {
          field: listField,
          arrayOperator: op,
          condition: { all: inner ? [inner] : [] },
        } as Condition;
      }
      const leaf = rest.length
        ? leafRuleAt(lens, target.mapName, target.modelName, rest, kind, opts)
        : null;
      return {
        field: listField,
        arrayOperator: op,
        condition: { all: [...whereConditions(where), ...(leaf ? [leaf] : [])] },
      } as Condition;
    }
    const target = relationTarget(entry, m);
    if (!target) return null;
    m = target.mapName;
    mod = target.modelName;
  }
  return null;
};

const collectionSeed = (lens: Lens, facet: Facet, opts: SurfaceOptions): Condition =>
  buildCollection(
    lens,
    lens.mapName,
    lens.model,
    (facet.path ?? '').split('.'),
    facet.defaultWhere ?? [],
    { i: 0 },
    facet.where,
    facet.kind,
    opts,
  ) ??
  ({
    field: facet.path,
    arrayOperator: facet.defaultWhere?.[0] ?? 'any',
    condition: { all: [] },
  } as Condition);

/**
 * Resolve a decoration's `facets` into `BuilderField`s to concat onto the anchor
 * surface. A leaf facet emits its real path as the rule `field`. A collection
 * facet contributes a **selector** field (carrying the `seed` array node the
 * picker inserts) and, when the array field isn't itself pickable, a non-pickable
 * **resolver** field so the seeded node's dotted `field` resolves its relation.
 */
export const describeFacets = (
  lens: Lens,
  decoration: Decoration,
  opts: SurfaceOptions = {},
): BuilderField[] => {
  const out: BuilderField[] = [];
  const fieldDecor = decoration.labels?.fields;
  const resolverFor = new Set<string>();
  for (const facet of decoration.facets) {
    if (facet.condition !== undefined) {
      // A preset: select it and its whole condition drops in as one atomic node.
      out.push({
        name: facetId(facet),
        label: facet.label ?? 'preset',
        icon: facet.icon,
        kind: 'String',
        isList: false,
        isBridge: false,
        operators: { field: [], date: [], array: [] },
        seed: facet.condition,
      });
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) continue;
    if (resolved.kind === 'leaf') {
      const field = buildLeafField(lens, facet, resolved, fieldDecor, opts);
      if (field) out.push(field);
      continue;
    }
    if (resolved.kind === 'branch') {
      out.push({
        name: facetId(facet),
        label: facet.label ?? resolved.prefix,
        icon: facet.icon,
        kind: 'String',
        isList: false,
        isBridge: false,
        operators: { field: [], date: [], array: [] },
        seed: branchSeed(lens, facet, resolved, opts),
      });
      continue;
    }
    const id = facetId(facet);
    const isWhole = id === resolved.listPath;
    out.push({
      name: id,
      label: facet.label ?? resolved.elementLeaf ?? resolved.listField,
      icon: facet.icon,
      kind: facet.kind ?? 'String',
      isList: true,
      isBridge: false,
      relation: isWhole ? resolved.target : undefined,
      operators: { field: [], date: [], array: [] },
      seed: collectionSeed(lens, facet, opts),
    });
    if (!isWhole && !resolverFor.has(resolved.listPath)) {
      resolverFor.add(resolved.listPath);
      const list = describeModelFields(
        lens,
        resolved.listOwner.mapName,
        resolved.listOwner.modelName,
        opts,
      ).find((f) => f.name === resolved.listField);
      if (list) out.push({ ...list, name: resolved.listPath, selectable: false, seed: undefined });
    }
  }
  return out;
};

/** Top-level fields a decoration consumes *wholesale* — a bare relation/field
 *  facet with no `where` and no deeper leaf. These are removed from the root
 *  selector so a moved thing lives in one place; `where`/deep facets leave their
 *  origin intact. */
export const consumedTopFields = (decoration: Decoration | undefined): Set<string> => {
  const consumed = new Set<string>();
  for (const facet of decoration?.facets ?? [])
    if (facet.path && !facet.where && !facet.path.includes('.')) consumed.add(facet.path);
  return consumed;
};

/** The target a facet's fixed `where` is matched under — the array field for a
 *  collection, the field path for a leaf. Facets sharing a target must have
 *  prefix-free fixed `where`s (see {@link validateDecoration}). */
const facetTarget = (lens: Lens, facet: Facet): string | undefined => {
  const resolved = resolvePath(lens, facet.path);
  if (!resolved) return undefined;
  return resolved.kind === 'collection' ? resolved.listPath : facet.path;
};

/**
 * The inverse of a facet: recognize a saved node as one of the decoration's facets
 * so `buildRoot` (and a renderer) collapses it back to the named entry. A leaf
 * matches on `field`; a collection matches when the node's leading condition block
 * equals the facet's fixed `where` (order/coercion-insensitive). Pure; `undefined`
 * when none matches.
 */
const groupChildren = (node: Condition): Condition[] | undefined => {
  const rec = node as { all?: Condition[]; any?: Condition[] };
  return Array.isArray(rec.all) ? rec.all : Array.isArray(rec.any) ? rec.any : undefined;
};

export const matchFacet = (
  lens: Lens,
  decoration: Decoration,
  node: Condition,
): Facet | undefined => {
  const rec = node as { field?: string; arrayOperator?: string; condition?: Condition };
  const children = groupChildren(node);
  const nodeKey = JSON.stringify(canonical(node));
  // Collection identities are subset-matched (order-tolerant); when several
  // facets' identities are contained in one block, the most specific wins.
  let best: Facet | undefined;
  let bestLead = -1;
  for (const facet of decoration.facets) {
    if (facet.condition !== undefined) {
      // A preset matches a node equal to its whole condition (coercion/order-insensitive).
      if (nodeKey === JSON.stringify(canonical(facet.condition))) return facet;
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) continue;
    if (resolved.kind === 'leaf') {
      if (rec.field === facet.path && rec.arrayOperator === undefined) return facet;
      continue;
    }
    if (resolved.kind === 'branch') {
      // A branch is a group. Prefer the fixed `where` as identity; absent one, a
      // group whose leaf fields all sit under `prefix.` is the branch.
      if (!children) continue;
      const lead = whereConditions(facet.where);
      if (lead.length > 0) {
        if (isLeadingPrefix(lead, children)) return facet;
        continue;
      }
      const leaves = children.filter((c) => c && typeof c === 'object' && 'field' in c);
      if (
        leaves.length > 0 &&
        leaves.every((c) =>
          String((c as { field: string }).field).startsWith(`${resolved.prefix}.`),
        )
      )
        return facet;
      continue;
    }
    if (rec.field !== resolved.listPath) continue;
    // Descend the traversal nodes (each a single nested array child) to the
    // innermost, where the fixed `where` and value sit. Operators are editable
    // defaults, not identity, so they are not checked — only path + `where`.
    let dest = rec;
    while (true) {
      const cs = (dest.condition as { all?: Condition[] } | undefined)?.all;
      if (cs?.length === 1 && cs[0] && typeof cs[0] === 'object' && 'arrayOperator' in cs[0]) {
        dest = cs[0] as typeof rec;
      } else break;
    }
    const lead = whereConditions(facet.where);
    const destConds = (dest.condition as { all?: Condition[] } | undefined)?.all ?? [];
    if (lead.length === 0) {
      // A whereless collection has no identity block, so require the element leaf to
      // actually appear — otherwise any array node on this field would mislabel as
      // this facet. A whole-collection facet (no leaf) has nothing to require.
      const leafName = resolved.elementLeaf?.split('.').pop();
      const applies =
        !resolved.elementLeaf ||
        destConds.some(
          (c) => c && typeof c === 'object' && (c as { field?: string }).field === leafName,
        );
      if (applies && bestLead < 0) {
        best = facet;
        bestLead = 0;
      }
      continue;
    }
    if (isSubset(lead, destConds) && lead.length > bestLead) {
      best = facet;
      bestLead = lead.length;
    }
  }
  return best;
};

/**
 * Reject a decoration whose facets could collide on rehydration — the guarantee
 * that reverse-matching is deterministic. Returns human-readable violations
 * (empty = valid): unresolvable paths, duplicate ids, a `defaultWhere` whose
 * length isn't the path's array-traversal count, and — the important one — two
 * facets on the same target whose fixed `where`s are not prefix-free (a rule
 * authored under the specific one would also match the general one).
 */
export const validateDecoration = (lens: Lens, decoration: Decoration): string[] => {
  const violations: string[] = [];
  const ids = new Set<string>();
  const byTarget = new Map<string, { facet: Facet; lead: Condition[] }[]>();

  for (const facet of decoration.facets) {
    if (facet.condition !== undefined) {
      // A preset must be a valid rule against the lens (it works as-is, no pickers).
      const id = facetId(facet);
      if (ids.has(id)) violations.push(`duplicate facet id '${id}'`);
      ids.add(id);
      if (!checkRuleAgainstLens(facet.condition, lens).ok)
        violations.push(`preset '${facet.label ?? id}' is not a valid rule against the lens`);
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) {
      violations.push(`facet '${facet.path}' does not resolve against the lens`);
      continue;
    }
    // A leaf facet ignores `where`/`defaultWhere` (they are collection concepts) —
    // and a `where` still folds into its id while its BuilderField keeps `name:
    // path`, so two leaf facets on the same path with different wheres emit two
    // identical picker options. Reject it outright.
    if (resolved.kind === 'leaf' && (facet.where || facet.defaultWhere))
      violations.push(
        `leaf facet '${facet.path}' cannot carry 'where'/'defaultWhere' — those are collection concepts`,
      );
    if (facet.defaultWhere) {
      const need = arrayTraversalCount(lens, facet.path);
      if (facet.defaultWhere.length !== need)
        violations.push(
          `facet '${facet.path}' has ${facet.defaultWhere.length} traversal operator(s) but the path crosses ${need} array boundary(ies)`,
        );
    }
    const id = facetId(facet);
    if (ids.has(id)) violations.push(`duplicate facet id '${id}'`);
    ids.add(id);
    const target = facetTarget(lens, facet);
    if (target === undefined) continue;
    const group = byTarget.get(target) ?? [];
    group.push({ facet, lead: whereConditions(facet.where) });
    byTarget.set(target, group);
  }

  for (const [target, group] of byTarget)
    for (let i = 0; i < group.length; i++)
      for (let j = 0; j < group.length; j++)
        if (i !== j && isLeadingPrefix(group[i].lead, group[j].lead)) {
          violations.push(
            `facets on '${target}' collide: '${group[i].facet.label ?? facetId(group[i].facet)}' is a leading prefix of '${group[j].facet.label ?? facetId(group[j].facet)}' — rehydration would be ambiguous`,
          );
          break;
        }

  return violations;
};

/** Flatten a decoration's field/value decor into `SurfaceOptions` label maps so
 *  `describeModelFields` applies the same relabeling to the anchor surface. */
export const decorationSurfaceOptions = (decoration: Decoration | undefined): SurfaceOptions => {
  const labels: Record<string, string> = {};
  for (const [key, decor] of Object.entries(decoration?.labels?.fields ?? {}))
    if (decor.label !== undefined) labels[key] = decor.label;

  const valueLabels: Record<string, Record<string, string>> = {};
  for (const [field, values] of Object.entries(decoration?.labels?.values ?? {})) {
    const perValue: Record<string, string> = {};
    for (const [value, decor] of Object.entries(values))
      if (decor.label !== undefined) perValue[value] = decor.label;
    if (Object.keys(perValue).length) valueLabels[field] = perValue;
  }

  return { labels, valueLabels };
};

/** Memoized hook form of {@link describeFacets}. In dev, surfaces
 *  {@link validateDecoration} violations as a `console.warn` so the collision-free
 *  invariant is enforced by the API, not just the docs. */
export const useFacetFields = (
  lens: Lens,
  decoration: Decoration | undefined,
  opts: SurfaceOptions = {},
): BuilderField[] => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on option fields, not opts identity, so inline literals don't re-run the walk
  const fields = useMemo(
    () => (decoration ? describeFacets(lens, decoration, opts) : []),
    [lens, decoration, opts.targets, opts.labels, opts.valueLabels],
  );
  useEffect(() => {
    if (!decoration || process.env.NODE_ENV === 'production') return;
    const violations = validateDecoration(lens, decoration);
    if (violations.length)
      console.warn(`[rules-builder] invalid Decoration:\n- ${violations.join('\n- ')}`);
  }, [lens, decoration]);
  return fields;
};
