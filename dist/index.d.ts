import * as _inixiative_json_rules from '@inixiative/json-rules';
import { Condition, ValueShape, FieldKind, Lens, RuleTarget, validateRule, RuleDescription, CheckOptions, EngineGlobalsState, Bridge, SourceValues, FieldMap } from '@inixiative/json-rules';
export { SourceValues } from '@inixiative/json-rules';
import { BuilderField, Decoration, SurfaceOptions, RuleBuilderSource } from './schema/index.js';
export { Decor, Facet, LensValueOption, LensValuePickerOptions, ResolveOptions, SourceRows, branchFields, consumedTopFields, decorationSurfaceOptions, describeFacets, describeModelFields, facetBranchScope, facetElementLeaf, facetId, isPreset, leadingIdentityCount, leadingWhereCount, lensValuePicker, matchFacet, modelDecor, modelFacets, relabelRelations, resolve, runSources, scopedDecoration, scopedFacetId, selectorsApply, stampFacetIds, useFacetFields, useLensValuePicker, validateDecoration, valueShapeForOperator, whereConditions, writeSelectorClause } from './schema/index.js';

type RulePathSegment = number | 'if' | 'then' | 'else' | 'condition' | 'filter';
type RulePath = RulePathSegment[];
declare const getNode: (cond: Condition, path: RulePath) => Condition | undefined;
declare const setNode: (cond: Condition, path: RulePath, node: Condition) => Condition;
declare const removeNode: (cond: Condition, path: RulePath) => Condition;
declare const addRule: (cond: Condition, parentPath: RulePath, node: Condition) => Condition;
declare const wrapInCompound: (cond: Condition, path: RulePath, kind: "all" | "any") => Condition;
declare const groupSiblings: (cond: Condition, parentPath: RulePath, indices: number[], kind: "all" | "any") => Condition;
declare const unwrapCompound: (cond: Condition, path: RulePath) => Condition;

type PickOption = {
    value: string;
    label: string;
    icon?: string;
    groups?: string[];
    /** Set on an aggregate numeric-target option: `false` marks a `Json` field, which
     *  the in-memory `check()` aggregates but `toPrisma()` cannot compile. */
    compilesToPrisma?: boolean;
};
type FieldControl = {
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
type OperatorControl = {
    value?: string;
    options: PickOption[];
    set: (op: string) => void;
};
type ValueControl = {
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
    path?: {
        value?: string;
        set: (p: string) => void;
    };
    /** Present in 'bind' mode — the binding name resolved at execution time. */
    bind?: {
        value?: string;
        set: (name: string) => void;
    };
};
type LeafNode = {
    kind: 'leaf';
    id: string;
    path: RulePath;
    depth: number;
    /** A field comparison (`field`) or a raw `true`/`false` literal (`boolean`). */
    leafKind: 'field' | 'boolean';
    /** Flip the leaf between a field comparison and a true/false literal. */
    setLeafKind: (k: 'field' | 'boolean') => void;
    /** Present when `leafKind === 'boolean'` — the literal value. */
    literal?: {
        value: boolean;
        set: (v: boolean) => void;
    };
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
type HoistBadge = {
    id: string;
    label: string;
    icon?: string;
};
type GroupNode = {
    kind: 'group';
    id: string;
    path: RulePath;
    depth: number;
    operator: {
        value: 'all' | 'any';
        set: (op: 'all' | 'any') => void;
    };
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
    selectors?: {
        field: string;
        label?: string;
        anyLabel?: string;
    }[];
    /** The canonical selector clauses hoisted out of the rows surface (mirrors
     *  {@link ArrayNode.selectorClauses}); absent when the group isn't canonical. */
    selectorClauses?: BuilderNode[];
    /** Create/replace (value) or remove (`null`) the clause for a declared selector
     *  field — writes into the top of the group itself, where branch identity
     *  lives, preserving the canonical shape and the rows group's operator. */
    setSelectorClause?: (field: string, value: unknown | null) => void;
    remove?: () => void;
};
type FacetModeControl = {
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
type AggregateControl = {
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
    value: {
        current?: number | [number, number];
        shape: ValueShape;
        set: (v: unknown) => void;
    };
};
type ArrayNode = {
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
    selectors?: {
        field: string;
        label?: string;
        anyLabel?: string;
    }[];
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
    relation?: {
        mapName: string;
        modelName: string;
    };
    /** Count operators (atLeast/atMost/exactly) → a numeric threshold. */
    count?: {
        value?: number;
        set: (n: number | undefined) => void;
    };
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
type BuilderNode = GroupNode | LeafNode | ArrayNode;
/** Normalize a (sub-)condition to a group so it has a compound to add into. Used for the array
 *  node's nested condition/filter sub-trees, which are always groups over the related elements. */
declare const asGroupRoot: (cond: Condition | undefined) => Condition;
/** The root is the condition itself — never synthetically wrapped. Only an absent condition
 *  becomes `empty` — a blank group by default (a first-class, add-into-able container), or a
 *  caller-supplied scaffold; a bare leaf or `true`/`false` stays bare. Absence is `undefined`
 *  only: a `null` from a DB row is the caller's to normalize at its own boundary. */
declare const asRoot: (cond: Condition | undefined, empty?: Condition) => Condition;
/**
 * Build the headless descriptor tree from a condition + composed lens. The root is whatever the
 * condition is — a group, a field leaf, an array rule, or a `true`/`false` literal leaf — never
 * force-wrapped. Pure: every action computes the next condition and calls `commit`.
 */
declare const buildRoot: (root: Condition, lens: Lens, fields: BuilderField[], maxDepth: number, commit: (next: Condition) => void, opts?: {
    decoration?: Decoration;
    surfaceOpts?: SurfaceOptions;
}) => BuilderNode;

type UseRuleBuilderOptions = {
    source: RuleBuilderSource;
    /** Fetched option sets for the source's sourced fields → folded onto field.values. */
    sourceValues?: _inixiative_json_rules.SourceValues[];
    targets?: RuleTarget[];
    /** Uncontrolled seed — read once at mount. Re-mount (`key`) or `setCondition` to reseed. */
    defaultValue?: Condition;
    /** What an absent condition seeds to — the blank-builder scaffold. Defaults to `{ all: [] }`.
     *  E.g. segments seed `{ any: [{ all: [] }, { field: 'uuid', operator: 'in', value: [] }] }`
     *  to scaffold "rule-matched OR hand-picked members". Read at mount and on
     *  `setCondition(undefined)`. */
    empty?: Condition;
    onChange?: (clean: Condition) => void;
    labels?: Record<string, string>;
    valueLabels?: Record<string, Record<string, string>>;
    /** A display decoration: hoists pre-traversed lens paths up to the root selector
     *  (additive) and relabels the surface. Purely presentational — the emitted
     *  rule and everything the engine runs are unchanged. */
    decoration?: Decoration;
    /** Max group nesting depth — a group at this depth hides "add group" (`canAddGroup`). Default 4. */
    maxDepth?: number;
};
/**
 * Headless rule builder. Owns the Condition JSON and exposes a `root` descriptor
 * tree (what controls exist at each level + bound actions). Renders nothing —
 * wire your own components to `root`. `value` is the cleaned, serializable output.
 */
type UseRuleBuilder = {
    value: Condition;
    root: BuilderNode;
    lens: Lens;
    /** Reseed the tree. `undefined` reseeds to `empty` — the "clear" gesture. */
    setCondition: (clean: Condition | undefined) => void;
    validate: (target: RuleTarget) => ReturnType<typeof validateRule>;
    describe: () => RuleDescription;
};
declare const useRuleBuilder: (opts: UseRuleBuilderOptions) => UseRuleBuilder;

type UseFilteredCollectionOptions<T> = Omit<UseRuleBuilderOptions, 'sourceValues'> & {
    /** The already-fetched collection to author against and filter. */
    rows: readonly T[];
    /** Passed through to `check` and source eligibility — feeds `{bind}` clauses. */
    checkOptions?: CheckOptions;
} & Partial<EngineGlobalsState['string']>;
type UseFilteredCollection<T> = UseRuleBuilder & {
    /** Rows matching the current cleaned rule. */
    data: T[];
};
/**
 * Headless rule builder over a collection in hand: `useRuleBuilder` plus the
 * in-memory half of the rules duality. The builder owns the one Condition;
 * sourced fields' option sets materialize from the rows themselves
 * (`sourceValuesFromRows` — declare `sources` on the source's narrowing and a
 * plain column becomes a pseudo-enum picker of the values that actually occur);
 * `data` is the rows passing the emitted (coercion-stamped) rule via `check()`.
 * For collections fetched whole — a calendar range, a Kanban board — where the
 * server owns scope and the narrowing is display-only. `source`, `rows`, and
 * `checkOptions` must be referentially stable (memoize at the call site).
 */
declare const useFilteredCollection: <T extends Record<string, unknown>>(opts: UseFilteredCollectionOptions<T>) => UseFilteredCollection<T>;

declare const switchGroupOperator: (node: Condition, kind: "all" | "any") => Condition;
declare const trimEmptyGroups: (node: Condition) => Condition | undefined;
declare const stripMeta: <T>(node: T) => T;
declare const withIds: (node: Condition, makeId?: () => string) => Condition;

/**
 * The serializable permission algebra (rebac/abac/rbac). Declared here so the builder
 * depends only on json-rules — structurally identical to `@inixiative/permissions`'
 * `ActionRule` (and the copy `@inixiative/transitions` re-declares).
 */
type ActionRule = string | {
    rel: string;
    action: string;
} | {
    self: string;
} | {
    rule: Condition;
} | {
    any: ActionRule[];
} | {
    all: ActionRule[];
} | boolean | null;
/** One resource's permission entry: `actions: { name → ActionRule }`. */
type ResourcePermission = {
    actions: Record<string, ActionRule>;
};
/**
 * The full permission schema, matching `@inixiative/permissions@0.2.0`: `permissions` maps a
 * map-qualified resource (`app:User`) to its actions; `bridges` are the cross-source edges a `rel`
 * walk may cross — carried so the schema is self-contained for the check engine.
 */
type RebacSchema = {
    bridges?: Bridge[];
    permissions: Record<string, ResourcePermission>;
};
type ActionRuleKind = 'delegate' | 'rel' | 'self' | 'rule' | 'any' | 'all' | 'allow' | 'deny';

type ActionPath = number[];
declare const actionKind: (rule: ActionRule) => ActionRuleKind;
declare const isActionGroup: (rule: ActionRule) => boolean;
declare const childrenOfAction: (rule: ActionRule) => ActionRule[];
/** The default leaf when a slot is created — an empty ABAC predicate, ready to author. */
declare const defaultActionRule: () => ActionRule;
declare const getActionNode: (rule: ActionRule, path: ActionPath) => ActionRule | undefined;
declare const setActionNode: (rule: ActionRule, path: ActionPath, next: ActionRule) => ActionRule;
declare const addActionChild: (rule: ActionRule, path: ActionPath) => ActionRule;
declare const removeActionNode: (rule: ActionRule, path: ActionPath) => ActionRule;

type KindControl = {
    value: ActionRuleKind;
    options: PickOption[];
    set: (k: ActionRuleKind) => void;
};
type Control = {
    value?: string;
    options: PickOption[];
    set: (v: string) => void;
};
type BaseNode = {
    id: string;
    path: ActionPath;
    depth: number;
    kind: KindControl;
    remove?: () => void;
};
/** A `rel` walk as a path of hops: one segment per relation crossed, each scoped to the resource
 *  reached so far (intra-map relations + bridges). `target` is the final resource. */
type RelControl = {
    segments: Control[];
    /** Relations available to append as the next hop (of the final resource). */
    addOptions: PickOption[];
    addSegment: (relation: string) => void;
    removeLast?: () => void;
    action: Control;
    target?: string;
};
type ActionLeafNode = BaseNode & {
    delegate?: Control;
    rel?: RelControl;
    self?: Control;
    rule?: BuilderNode;
};
type ActionGroupNode = BaseNode & {
    children: ActionRuleNode[];
    addChild?: () => void;
};
type ActionRuleNode = ActionLeafNode | ActionGroupNode;
type BuildActionOptions = {
    lens: Lens;
    fields: BuilderField[];
    /** Other action names on this resource — delegate targets. */
    siblingActions: string[];
    /** Action names per resource (`map:model`) — the `rel` walk's target actions. */
    actionsByResource: Record<string, string[]>;
    /** Fields of any resource (`map:model`) — needed to scope hops past the first. */
    resourceFields?: (resource: string) => BuilderField[];
    maxDepth?: number;
    commit: (next: ActionRule) => void;
};
declare const buildActionRoot: (rule: ActionRule, opts: BuildActionOptions) => ActionRuleNode;

/** Every resource's action names, keyed by resource (`map:model`) — the awareness
 *  `useActionRuleBuilder` needs for `delegate` (same-resource) and `rel` (a target's actions). */
declare const actionNamesByResource: (schema: RebacSchema) => Record<string, string[]>;
/** Immutably set one resource.action's rule, creating the resource entry if absent. */
declare const setSchemaAction: (schema: RebacSchema, resource: string, action: string, rule: ActionRule) => RebacSchema;
/** Immutably drop one resource.action (and the resource entry if it becomes empty). */
declare const removeSchemaAction: (schema: RebacSchema, resource: string, action: string) => RebacSchema;

type UseActionRuleBuilderOptions = {
    /** The lens/narrowing the rule is authored against — its fields, relations, and surface. */
    source: RuleBuilderSource;
    sourceValues?: SourceValues[];
    /** Uncontrolled seed — read once at mount. Re-mount (`key`) or `setRule` to reseed. */
    defaultValue?: ActionRule;
    onChange?: (rule: ActionRule) => void;
    /** Other action names on this resource → delegate targets. */
    siblingActions?: string[];
    /** Action names per resource (`map:model`) → the `rel` walk's target actions. */
    actionsByResource?: Record<string, string[]>;
    maxDepth?: number;
};
/**
 * Headless builder for the recursive permission algebra (`ActionRule`) over a
 * lens/narrowing base. Owns the rule; exposes a `root` descriptor tree. The `rule`
 * (abac) leaf embeds the json-rules builder; `self`/`rel`/`delegate` are resource-aware.
 */
type UseActionRuleBuilder = {
    value: ActionRule;
    root: ActionRuleNode;
    setRule: (rule: ActionRule) => void;
};
declare const useActionRuleBuilder: (opts: UseActionRuleBuilderOptions) => UseActionRuleBuilder;

type UsePermissionBuilderOptions = {
    /** The whole rebac schema ({ bridges, permissions }). Controlled — edits flow out via onChange. */
    value: RebacSchema;
    onChange: (schema: RebacSchema) => void;
    /** The fieldMaps — each resource's RAW record surface (full fields + relations) is built from these. */
    maps: Record<string, FieldMap>;
    /** Bridges, so `rel` walks can reach cross-map relations. */
    bridges?: Bridge[];
    maxDepth?: number;
};
/**
 * Schema-level permission builder: owns the entire rebac schema (in/out via value/onChange +
 * setSchema) across every resource (`map:model`). A permission gates the RAW record, so each
 * resource's editing surface is built straight from the fieldMaps. Hands each resource.action's
 * recursive ActionRule editor as a descriptor (`actionRoot`).
 */
type UsePermissionBuilder = {
    value: RebacSchema;
    setSchema: (schema: RebacSchema) => void;
    /** Resources (`map:model`) with a permission entry. */
    resources: string[];
    /** Every resource's action names — `delegate` / `rel` awareness. */
    actionsByResource: Record<string, string[]>;
    actionsOf: (resource: string) => string[];
    addResource: (resource: string) => void;
    removeResource: (resource: string) => void;
    addAction: (resource: string, action: string) => void;
    removeAction: (resource: string, action: string) => void;
    setAction: (resource: string, action: string, rule: ActionRule) => void;
    /** The descriptor tree for one resource.action's rule (null if unknown / not in the maps). */
    actionRoot: (resource: string, action: string) => ActionRuleNode | null;
};
declare const usePermissionBuilder: (opts: UsePermissionBuilderOptions) => UsePermissionBuilder;

/**
 * A rule packaged for storage/transport: the `rule` itself, a `source` reference
 * binding it to the lens/narrowing it was authored against, and the `sourceValues`
 * captured at author time so data-backed (sourced) option sets survive a round-trip
 * without re-querying.
 *
 * `source` is generic: a self-contained app passes a `RuleBuilderSource`; an app
 * with a registry of named lenses/narrowings passes its own by-name ref. The
 * library only owns the envelope and validates its structure on parse.
 */
type SavedRule<TSource = unknown> = {
    source: TSource;
    rule: Condition;
    sourceValues?: SourceValues[];
};
/** Serialize a SavedRule. Pretty-prints (indent 2) by default. */
declare const stringifySavedRule: <TSource>(saved: SavedRule<TSource>, space?: number) => string;
/** Parse + structurally validate a SavedRule. Throws on malformed input. */
declare const parseSavedRule: <TSource = unknown>(json: string) => SavedRule<TSource>;

/**
 * The serializable transition primitives, matching `@inixiative/transitions`. Re-declared here so
 * the builder depends only on json-rules; the `permission` side reuses the permissions `ActionRule`.
 * The builder only authors *serializable* merges (a callback merge is not representable in a UI).
 */
type MergeStrategy = 'spread' | 'deepMerge' | {
    kind: 'append';
    path: string;
} | {
    kind: 'appendUnique';
    path: string;
};
/** One half of a transition. `from.*` reads the current record, `to.*` the merged record. */
type Side = {
    predicate: Condition;
    permission?: ActionRule;
};
type ToSide = Side & {
    merge?: MergeStrategy;
};
/** An atomic edge: `from → to`. Disjunction lives at the action level, never here. */
type Transition = {
    from: Side;
    to: ToSide;
};
/** A named verb: the OR of its edges, + affordance metadata. */
type Action = {
    paths: Transition[];
    label?: string;
};
/** `resource → action → Action` (resource is map-qualified, `db:Inquiry`). */
type TransitionMap = Record<string, Record<string, Action>>;
type SideKey = 'from' | 'to';

/** A new action starts with a single empty edge. */
declare const emptyAction: () => Action;

type UseTransitionBuilderOptions = {
    /** The whole transition schema (resource → action → Action). Controlled — edits flow via onChange. */
    value: TransitionMap;
    onChange: (schema: TransitionMap) => void;
    maps: Record<string, FieldMap>;
    bridges?: Bridge[];
    /** The permission schema's actions per resource — `delegate`/`rel` awareness for a side's permission. */
    permissionActions?: Record<string, string[]>;
    maxDepth?: number;
};
/**
 * Schema-level transition builder. Owns the whole TransitionMap; hands each edge's `from`/`to`
 * predicate as a json-rules descriptor (`predicateRoot`, via buildRoot) and each side's optional
 * authz `permission` as an ActionRule descriptor (`permissionRoot`, via buildActionRoot). Surfaces
 * are built from the maps per resource (`map:model`); `to.merge` is a serializable strategy.
 */
type UseTransitionBuilder = {
    value: TransitionMap;
    setSchema: (s: TransitionMap) => void;
    resources: string[];
    actionsOf: (resource: string) => string[];
    addResource: (resource: string) => void;
    removeResource: (resource: string) => void;
    addAction: (resource: string, action: string) => void;
    removeAction: (resource: string, action: string) => void;
    pathCount: (resource: string, action: string) => number;
    addPath: (resource: string, action: string) => void;
    removePath: (resource: string, action: string, i: number) => void;
    predicateRoot: (resource: string, action: string, i: number, side: SideKey) => BuilderNode | null;
    permissionHas: (resource: string, action: string, i: number, side: SideKey) => boolean;
    enablePermission: (resource: string, action: string, i: number, side: SideKey) => void;
    clearPermission: (resource: string, action: string, i: number, side: SideKey) => void;
    permissionRoot: (resource: string, action: string, i: number, side: SideKey) => ActionRuleNode | null;
    mergeOf: (resource: string, action: string, i: number) => MergeStrategy | undefined;
    setMerge: (resource: string, action: string, i: number, merge: MergeStrategy | undefined) => void;
};
declare const useTransitionBuilder: (opts: UseTransitionBuilderOptions) => UseTransitionBuilder;

export { type Action, type ActionGroupNode, type ActionLeafNode, type ActionPath, type ActionRule, type ActionRuleKind, type ActionRuleNode, type AggregateControl, type ArrayNode, type BuildActionOptions, BuilderField, type BuilderNode, Decoration, type FacetModeControl, type FieldControl, type GroupNode, type LeafNode, type MergeStrategy, type OperatorControl, type PickOption, type RebacSchema, type ResourcePermission, RuleBuilderSource, type RulePath, type RulePathSegment, type SavedRule, type Side, type SideKey, SurfaceOptions, type ToSide, type Transition, type TransitionMap, type UseActionRuleBuilder, type UseActionRuleBuilderOptions, type UseFilteredCollection, type UseFilteredCollectionOptions, type UsePermissionBuilder, type UsePermissionBuilderOptions, type UseRuleBuilder, type UseRuleBuilderOptions, type UseTransitionBuilder, type UseTransitionBuilderOptions, type ValueControl, actionKind, actionNamesByResource, addActionChild, addRule, asGroupRoot, asRoot, buildActionRoot, buildRoot, childrenOfAction, defaultActionRule, emptyAction, getActionNode, getNode, groupSiblings, isActionGroup, parseSavedRule, removeActionNode, removeNode, removeSchemaAction, setActionNode, setNode, setSchemaAction, stringifySavedRule, stripMeta, switchGroupOperator, trimEmptyGroups, unwrapCompound, useActionRuleBuilder, useFilteredCollection, usePermissionBuilder, useRuleBuilder, useTransitionBuilder, withIds, wrapInCompound };
