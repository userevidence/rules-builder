import * as _inixiative_json_rules from '@inixiative/json-rules';
import { FieldKind, Operator, DateOperator, ArrayOperator, SourceOption, SourceValues, FieldMap, Bridge, LensNarrowing, RuleTarget, Lens, ValueShape, Condition } from '@inixiative/json-rules';
export { SourceValues } from '@inixiative/json-rules';

type RuleBuilderSource = {
    maps: Record<string, FieldMap>;
    bridges?: Bridge[];
    mapName: string;
    model: string;
    narrowing?: Omit<LensNarrowing, 'parent'>;
};
type ResolveOptions = {
    sourceValues?: readonly SourceValues[];
};
/**
 * Resolve a serializable source (+ optional fetched `sourceValues`) to the public
 * surface the builder reads. Folds createLens + narrowing + value-decoration +
 * projection in one call — fetched options land on `field.options` inside the
 * projection, never by mutating the maps.
 */
declare const resolve: (source: RuleBuilderSource, opts?: ResolveOptions) => Lens;
type BuilderField = {
    name: string;
    label: string;
    /** Optional display glyph, carried from a {@link Decoration} hoisted entry. */
    icon?: string;
    kind: FieldKind;
    isList: boolean;
    relation?: {
        mapName: string;
        modelName: string;
    };
    isBridge: boolean;
    operators: {
        field: Operator[];
        date: DateOperator[];
        array: ArrayOperator[];
    };
    /** A hoisted collection entry seeds this whole `Condition` on select (an array
     *  node with a pre-filled `where`/operator) instead of the default `{field}` rule.
     *  Set by {@link Decoration}; absent for ordinary and leaf-hoisted fields. */
    seed?: _inixiative_json_rules.Condition;
    /** False for a hoist *resolver* field — present only so a seeded array node's
     *  dotted `field` resolves its relation, never offered in the picker. */
    selectable?: boolean;
    /** The surface's option set verbatim — a grouped source's options carry their
     *  partition keys in `groups` (index-aligned with `groupBy`). `enumValues`/
     *  `enumLabels` stay the flattened view for renderers that don't partition. */
    options?: readonly SourceOption[];
    /** The source's partition axes (dotted paths on this model, json-rules 2.18) —
     *  a sibling clause on an axis pins this field's options to that partition. */
    groupBy?: readonly string[];
    /** Present for enums and pseudo-enums (value-bearing fields) → render a select. */
    enumValues?: readonly string[];
    /** Human-readable labels for enum/sourced option values (value → label). */
    enumLabels?: Record<string, string>;
    /** A `Json` column: no declared sub-fields, but the kernel resolves a dotted JSON
     *  path on the operand — a renderer may let the user append a freeform sub-path. */
    acceptsSubPath?: boolean;
    /** True when this scalar can be the numeric target of a `sum`/`avg` aggregate over
     *  a list relation — a numeric scalar (Int/Float/Decimal/BigInt) or a `Json` column.
     *  Consumed by the {@link ArrayNode} aggregate facet's field picker. */
    aggregatable?: boolean;
    /** For an `aggregatable` field: whether `toPrisma()` can compile a `groupBy` over it.
     *  `true` for numeric scalars; `false` for `Json` — the in-memory `check()` runs a
     *  Json aggregate fine, but Prisma `groupBy` cannot `_sum`/`_avg` a JSON-extracted
     *  value, so a renderer should warn rather than emit a rule that 500s on DB eval. */
    compilesToPrisma?: boolean;
};
type SurfaceOptions = {
    targets?: RuleTarget[];
    /** Field labels, keyed by `name` or `Model.name`. */
    labels?: Record<string, string>;
    /** Enum/sourced value labels, keyed by `name` or `Model.name` → (value → label). */
    valueLabels?: Record<string, Record<string, string>>;
};
declare const describeModelFields: (lens: Lens, mapName: string, modelName: string, opts?: SurfaceOptions) => BuilderField[];
declare const valueShapeForOperator: (operator: Operator | DateOperator | ArrayOperator) => ValueShape;

type Decor = {
    label?: string;
    icon?: string;
};
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
type Facet = {
    path?: string;
    where?: Condition;
    defaultWhere?: ArrayOperator[];
    kind?: FieldKind;
    /** Declared inner selector rows (e.g. the field picker inside a source
     *  container): ordinary editable conditions on these fields that a renderer
     *  draws as dedicated dropdowns ("Field: [Any ▾]") instead of hardcoding the
     *  paths. Surfaced verbatim on a matched node. Options for the row come from
     *  the field's own source; a grouped value leaf pins off these siblings. */
    selectors?: {
        field: string;
        label?: string;
        anyLabel?: string;
    }[];
    /** A preset: the complete pre-authored condition this facet aliases. When set,
     *  `path` and the traversal fields are ignored. */
    condition?: Condition;
} & Decor;
/** A preset facet aliases a whole pre-authored condition (atomic; no pickers). */
declare const isPreset: (facet: Facet) => boolean;
/**
 * A display decoration over a lens: hoisted facets plus structural/path
 * relabeling. It renames and reorders what the builder *offers*; it never changes
 * what the lens admits or what the engine runs. Validate it with
 * {@link validateDecoration} so its facets can never collide on rehydration.
 */
type Decoration = {
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
/** A `where` may be a single condition or an `all` group — normalize to the flat
 *  list of leading conditions it contributes. */
declare const whereConditions: (where: Condition | undefined) => Condition[];
/** The label/icon for a model (or bridge target), keyed `map:Model` or `Model`.
 *  This is how the **root/anchor** and any relation get retagged — a to-one or
 *  list field reads as its target's friendly name. */
declare const modelDecor: (decoration: Decoration | undefined, mapName: string, modelName: string) => Decor;
/** Retag relation fields (to-one and list) by their target model's `labels.models`
 *  entry, so a field surface reads in customer terms wherever it's shown. */
declare const relabelRelations: (fields: BuilderField[], decoration: Decoration | undefined) => BuilderField[];
/** A stable id — the selector option value and React key. Only the *fixed* `where`
 *  folds in (it is identity); `defaultWhere` is editable, so it never does. The
 *  `where` is canonicalized (like every comparison here) so key order doesn't
 *  yield different ids for structurally identical wheres. */
declare const facetId: (facet: Facet) => string;
/** The element leaf's descriptor with any `kind` override applied — used to seed
 *  the value rule and (on rehydration) to retype the element surface. */
declare const facetElementLeaf: (lens: Lens, facet: Facet, opts?: SurfaceOptions) => BuilderField | undefined;
/** How many of a matched `node`'s leading conditions are the facet's fixed `where`
 *  (0 when it isn't at this node — e.g. an upstream traversal node whose `where`
 *  lives deeper). A renderer hides exactly this many. Reads an array node's
 *  `condition.all` or a group's own `all`/`any`. */
declare const leadingWhereCount: (facet: Facet, node: Condition) => number;
/** {@link leadingWhereCount} generalized to the full identity block: the fixed
 *  `where` prefix plus — immediately after it — the first clause per declared
 *  selector field. A selector clause is identity the `where` machinery can't see
 *  (it's user-picked data, not decoration), yet absorbing it into an `any` breaks
 *  the facet's meaning exactly the same way — "answered the question at all OR
 *  gave one of these answers". Duplicate clauses on a selector field stay
 *  ordinary rows (only the first is the selector's own knob). */
declare const leadingIdentityCount: (facet: Facet, node: Condition) => number;
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
declare const branchFields: (lens: Lens, prefix: string, target: {
    mapName: string;
    modelName: string;
}, opts?: SurfaceOptions) => BuilderField[];
/** The scope a branch facet's group is authored against — its `prefix` and the
 *  prefixed field surface. `undefined` when the facet isn't a branch. */
declare const facetBranchScope: (lens: Lens, facet: Facet, opts?: SurfaceOptions) => {
    prefix: string;
    fields: BuilderField[];
} | undefined;
/**
 * Resolve a decoration's `facets` into `BuilderField`s to concat onto the anchor
 * surface. A leaf facet emits its real path as the rule `field`. A collection
 * facet contributes a **selector** field (carrying the `seed` array node the
 * picker inserts) and, when the array field isn't itself pickable, a non-pickable
 * **resolver** field so the seeded node's dotted `field` resolves its relation.
 */
declare const describeFacets: (lens: Lens, decoration: Decoration, opts?: SurfaceOptions) => BuilderField[];
/** Top-level fields a decoration consumes *wholesale* — a bare relation/field
 *  facet with no `where` and no deeper leaf. These are removed from the root
 *  selector so a moved thing lives in one place; `where`/deep facets leave their
 *  origin intact. */
declare const consumedTopFields: (decoration: Decoration | undefined) => Set<string>;
declare const matchFacet: (lens: Lens, decoration: Decoration, node: Condition) => Facet | undefined;
/**
 * Ingest pass: stamp every recognizable node with its facet's id — `__facetId`,
 * the node's own session facet state (id = attached; `null` = detached to raw;
 * absent = open to search). Stamping pins recognition by id for the session, so
 * a node's facet-hood can't silently re-derive differently as siblings change.
 * Already-stamped (including detached) nodes pass through untouched. Session
 * meta only: stripMeta drops the key before `value` emits, so a saved rule
 * always reloads via a fresh search. Array `condition`/`filter` subtrees are
 * scoped to the RELATED model — the builder never facet-matches inside them, so
 * the walk stops at the array node, exactly like buildNodes.
 */
declare const stampFacetIds: (condition: Condition, lens: Lens, decoration: Decoration) => Condition;
/**
 * Write a selector clause into a facet node's `condition`, preserving the
 * canonical shape and the rows group's own operator. `value: null` removes the
 * clause. This is the ONE write seam for selector dropdowns: an existing clause
 * is replaced in place; a new clause lands in the identity block ABOVE the rows
 * group — never inside it — so a prior ALL/ANY toggle keeps meaning what it said:
 * `{ any: rows }` becomes `{ all: [clause, { any: rows }] }`, not
 * `{ any: [clause, ...rows] }`.
 */
declare const writeSelectorClause: (facet: Facet, condition: Condition | undefined, field: string, value: unknown) => Condition;
/**
 * Reject a decoration whose facets could collide on rehydration — the guarantee
 * that reverse-matching is deterministic. Returns human-readable violations
 * (empty = valid): unresolvable paths, duplicate ids, a `defaultWhere` whose
 * length isn't the path's array-traversal count, and — the important one — two
 * facets on the same target whose fixed `where`s are not prefix-free (a rule
 * authored under the specific one would also match the general one).
 */
declare const validateDecoration: (lens: Lens, decoration: Decoration) => string[];
/** Flatten a decoration's field/value decor into `SurfaceOptions` label maps so
 *  `describeModelFields` applies the same relabeling to the anchor surface. */
declare const decorationSurfaceOptions: (decoration: Decoration | undefined) => SurfaceOptions;
/** Memoized hook form of {@link describeFacets}. In dev, surfaces
 *  {@link validateDecoration} violations as a `console.warn` so the collision-free
 *  invariant is enforced by the API, not just the docs. */
declare const useFacetFields: (lens: Lens, decoration: Decoration | undefined, opts?: SurfaceOptions) => BuilderField[];

/** One pickable value-location in a lens. `path` is dotted from the start model
 *  (e.g. `tier`, `account.industry`). The shared atom behind a rule's `field`
 *  (LHS) and `path` (RHS reference), and reusable downstream (permissions, email). */
type LensValueOption = {
    path: string;
    field: string;
    kind: FieldKind;
    label: string;
    isList: boolean;
    values?: readonly string[];
    /** A `Json` column has no declared sub-fields, but the kernel resolves a dotted
     *  sub-path into it (`check`/`toPrisma`/`toSql`). When set, a renderer may let the
     *  user append a freeform sub-path to `path` (e.g. `metadata` → `metadata.theme`). */
    acceptsSubPath?: boolean;
};
type LensValuePickerOptions = {
    mapName?: string;
    model?: string;
    /** How many relation hops to traverse. 0 = the start model's own values only. */
    maxDepth?: number;
    /** path → display label override. */
    labels?: Record<string, string>;
};
/**
 * Enumerate the value-locations reachable through a lens — every leaf scalar/enum,
 * optionally across relations up to `maxDepth`, as dotted paths. Relations are
 * traversed but never emitted (you pick a value, not a relation). Pure.
 */
declare const lensValuePicker: (lensOrNarrowing: Lens | LensNarrowing, opts?: LensValuePickerOptions) => LensValueOption[];
/** Memoized hook form of {@link lensValuePicker}. */
declare const useLensValuePicker: (lensOrNarrowing: Lens | LensNarrowing, opts?: LensValuePickerOptions) => LensValueOption[];

/** Rows the app already has in memory, keyed by model name. */
type SourceRows = Record<string, Record<string, unknown>[]>;
/**
 * Run a lens/narrowing's compiled source queries over in-memory rows: filter each
 * by the composed `where` via `check()`, then DISTINCT the column. This is the
 * "fetch then filter through the rules" step the engine leaves to the app — the
 * result is the `sourceValues` you hand back to `resolve`/`useRuleBuilder` so a
 * sourced field becomes a constrained option set (a pseudo-enum).
 *
 * Real apps run the compiled query (`toSql`/`toPrisma`) against a database; this
 * is the same shape over local rows.
 */
declare const runSources: (lensOrNarrowing: Lens | LensNarrowing, rows: SourceRows) => SourceValues[];

export { type BuilderField, type Decor, type Decoration, type Facet, type LensValueOption, type LensValuePickerOptions, type ResolveOptions, type RuleBuilderSource, type SourceRows, type SurfaceOptions, branchFields, consumedTopFields, decorationSurfaceOptions, describeFacets, describeModelFields, facetBranchScope, facetElementLeaf, facetId, isPreset, leadingIdentityCount, leadingWhereCount, lensValuePicker, matchFacet, modelDecor, relabelRelations, resolve, runSources, stampFacetIds, useFacetFields, useLensValuePicker, validateDecoration, valueShapeForOperator, whereConditions, writeSelectorClause };
