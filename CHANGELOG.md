# Changelog

## 0.24.1 — catch-all facets are sanctioned

- **A catch-all facet coexists with stricter projections on the same target.**
  `validateDecoration` no longer treats an empty `where` as a colliding prefix,
  and the selector-completion rejection is removed: a whereless facet (or one
  whose selector pick completes a stricter facet's identity) is the fallback,
  and the stricter facet wins on rehydration — deterministic refinement, not
  ambiguity. Pick `key = nps` under a generic "Custom Field" facet, reload, and
  the node upgrades to the curated "NPS" facet.
- Example app: compact form styling; selector dropdowns and the facetMode
  toggle in the shadcn renderer; a Decorations tab — author facets (anchor and
  per-model scopes, selectors, wheres) with live `validateDecoration` output,
  saved decorations selectable in the Builder tab.

## 0.24.0 — selector clauses are facet identity

- **A selector-backed facet's picked clause (the survey question, the badge
  name) is identity the `where` machinery can't see** — user data, not
  decoration, but absorbing it into an `any` corrupts the meaning identically
  ("answered THE question with one of these" → "answered it at all, OR gave one
  of these answers"). The canonical shape now hoists it next to the fixed
  `where`: `{ all: [...where, ...selector clauses, { all|any: rows }] }`.
  Ingest normalizes flat legacy trees into it; only the FIRST clause per
  declared selector field hoists (a duplicate stays an ordinary, visible row).
- **New node surface**: `selectorClauses` (real builder nodes for the hoisted
  clauses — dropdowns read/edit through them while the toggle can only re-key
  the rows group) and `setSelectorClause(field, value)` — the one write seam:
  replace at position, `null` removes, an array value writes an `in` clause,
  and a new clause conjoins ABOVE the rows group, never inside it. Present on
  collection nodes AND branch facet groups — one block-level seam
  (`writeSelectorClause`): a branch group writes at its own top, a collection
  at its own `condition`, and nothing ever writes across a model boundary.
- **A same-field clause counts as the selector's own ONLY when conjoined** —
  inside an `any` it is a disjunct meaning something else, so the write seam
  never replaces or removes it; a write conjoins outside and the disjunct stays
  an honestly visible row. (An already-corrupted `any` tree still matches and
  renders raw, unrewritten — repair is a migration, not a silent load-time
  semantic change.)
- **Per-model facets — recognition at every level, natively**
  (`Decoration.models`, keyed `map:Model` or `Model`): a model's facets apply
  wherever an array `condition` surface for that model is built, at any depth —
  declared once, recognized on every route, offered as picker seeds in nested
  builders. Paths are relative to the model, so every facet is single-hop at
  its own level by construction: identity never lives across a model boundary
  from the node that wears its chrome. Never at the anchor root (that is
  `facets`' curated set), never in `filter` subtrees or aggregate windows.
  Ingest re-anchors the same way: `stampFacetIds` recurses into each array
  node's `condition` with the related model's lens and facets.
- **Anchor facets no longer reach down traversal chains** (design-adversarial
  ruling): a multi-hop path facet is a picker SEED only — the pre-traversed
  entry point stays, but recognition and normalization never descend a chain,
  so the inner block has exactly one possible owner (the model-scoped facet)
  and a nested-array user row can never be mistaken for a traversal hop. The
  outer seed and the inner recognition compose without knowing about each
  other. Grafted rows groups are never re-badged by inner recognition.
- **Stamps are scope-qualified** (`map:Model/facetId`, from the resolved scope
  lens): a stamp minted under another scope resolves to no facet and falls
  through to an ordinary search. `facetId` itself stays unscoped (it is also
  the picker field name and the whole-collection sentinel).
- **`validateDecoration` validates every scope**: each `models[...]` list is
  checked against the same lens construction the runtime scopes with (once per
  map binding for bare-`Model` keys), and a new collision class is rejected —
  facet B's `where` being facet A's `where` plus clauses on A's declared
  selector fields (a pick under A would rehydrate as B's fixed identity).
- **The seam never crosses a structural boundary** (adversarial findings):
  selectors apply only where the machinery can actually see the clause — a
  branch group or a single-hop collection (`selectorsApply`). The fixed `where`
  is untouchable even when it sits on the declared selector field (the clause
  search starts after the where prefix). On the live surfaces a clause in the
  FINAL position is never the selector's (a canonical tree always ends with
  the rows group), so what renders as a row is never replaced or deleted by a
  dropdown gesture. The seam exists only where every part of it is real:
  never on presence nodes (no condition surface) and never on presets
  (atomic). A hoisted clause node's `remove()` routes through the seam, so
  both removal gestures land on the same shape. Nested sub-roots are labeled
  with their OWN model's decor, not the anchor's.
- **Complex selectors**: an internal OR block whose every child is a leaf on
  the same declared selector field (`{ any: [q=Q1, q=Q2] }`) IS the selector's
  clause — hoisted as its own block so the rows toggle can't absorb it, and
  surfaced through `selectorClauses` as a group.
- Exported: `leadingIdentityCount(lens, facet, node)`, `writeSelectorClause`
  (one block-level seam for both node kinds), `selectorsApply`, `modelFacets`,
  `scopedDecoration`, `scopedFacetId`.

## 0.23.1 — adversarial fixes: disjunct identity never matches; no remove on the rows surface

- **An `any` compound never matches a where-carrying branch facet.** Identity is
  identity only when AND-ed — inside `any` the clause is a disjunct. Both the
  matcher and `leadingWhereCount` now require an `all` compound, so
  `{ any: [where, { all: rows }] }` (reachable via detach → toggle → re-attach)
  renders honestly raw instead of hiding the disjunct and displaying AND
  semantics over an OR rule.
- **The collapsed rows group exposes no `remove`.** The condition surface keeps
  the sub-root contract (`remove: undefined`); previously the rows group's own
  remove leaked through, letting one gesture delete every user row and strand
  the hidden identity.

## 0.23.0 — canonical facet shape; the lock machinery is gone

- **A facet's rule now carries an explicit user-rows group from birth**:
  `{ all: [...where, { all|any: [...rows] }] }`. Seeds emit it; ingest normalizes
  every recognized node into it (legacy flat rules, hand/AI-authored clause
  order, and the 0.22 nested-any toggle shape all land on the same canonical
  form — an `all` reorder plus a one-group wrap, semantics never change).
- **The rows group IS the facet's editable surface.** The builder hands a
  renderer the rows group itself — its toggle, paths, addRule, and children are
  real — and the identity is simply not part of the view. `lockedGroupView`
  (the flatten-the-nest view rewrite) and **`lockedLeading` are deleted**:
  there is nothing to lock because nothing user-controlled contains the
  identity. Removing the facet node removes the whole unit.
- **A non-canonical live lookalike renders honestly raw**: a hand-authored
  match mid-session gets the badge with every row visible and editable — its
  toggle visibly changes the rule and breaks the bind, instead of silently
  absorbing a hidden clause. (`facetMode` session detach shows the same true
  structure and is unchanged.)
- **Composition never extends a facet's umbrella**: recognition is per-node and
  exact; a facet claims precisely its own subtree. Reconciliation of multiple
  candidates is unchanged (validateDecoration forbids real collisions;
  most-specific identity wins for collections; resolved once at ingest and
  pinned by `__facetId` for the session).
- Renderer migration: drop any `lockedLeading` slicing — children are already
  exactly what should render.

## 0.22.0 — the facet ALL/ANY toggle keeps the fixed where AND-ed; `__`-prefixed meta keys

- **Facet toggle no longer ORs the identity clause into user rows** (ZLT-3899).
  On a locked group, toggling ANY writes `{ all: [...locked, { any: [...rows] }] }`
  and the new locked view flattens the nested tail back into a flat row list, so
  a renderer still sees one group whose operator reads `any`. Identity stays a
  leading AND — recognition needs no shape change. `axisSiblings` walks ancestor
  `all` groups so partition pinning survives inside the nested any; whereless
  facets read `all ?? any` (nothing to protect there).
- **Editor meta keys are `__`-prefixed**: `_id`/`_groupId` → `__id`/`__groupId`
  (`__` marks internal values; a single `_` is for unused bindings — matching
  json-rules' `__step`). Session-only: `stripMeta` removes them before `value`
  emits, so no persisted rule changes. Group rewrites share one `groupMeta`
  carry-over, so no rewrite sheds a group's `error` annotation; facet
  canonicalization drops meta by the same `_`-prefix rule.
- **`operator.set` drops the stale operand on isEmpty/isNotEmpty** — validateRule
  rejected it, leaving the leaf permanently invalid with no visible cause.
- **A DateTime field seeds its default rule from the date catalog** (`before`),
  not full-timestamp `equals` (a calendar-picked day almost never matches).
- **Session facet detach — `facetMode` + `__facetId`, the escape hatch from facet
  capture.** `__facetId` is the node's own facet state: the facet's id when
  attached — stamped once at ingest (`stampFacetIds`, exported) so recognition
  is pinned rather than re-derived as siblings change — `null` when the user
  detaches to raw (recognition suspends; hoist/lock drop; identity rows render
  as plain editable children), absent when the node is open to search. The
  `facetMode` control on hoisted group/array nodes toggles faceted ⇄ raw;
  re-attach deletes the key and re-scans, recapturing iff the rows still form a
  facet. Session-only: `stripMeta` drops the key before `value` emits, so a
  saved rule always reloads faceted.
- **The pin never exempts a node from being its facet's shape**: a stamped id is
  structurally re-verified against the pinned facet alone, so an edit that
  removes the identity (e.g. switching the collection operator to a presence op)
  breaks the bind honestly instead of leaving a badge over a drifted rule.
- **Out-of-order identity blocks are normalized at ingest**: subset matching
  accepts the fixed `where` anywhere in the block, but the toggle lock keys off
  the leading prefix — ingest now hoists identity clauses to leading (an `all`
  reorder, semantics unchanged), so the lock engages for hand/AI-authored order.
- Requires `@inixiative/json-rules` ^2.18.3, whose `toPrisma` no longer compares
  non-String columns to `''` — the other half of the same incident.

## 0.20.0 — sibling-derived partition pinning (dependent vocabularies)

- **Author-time pin, inferred from the rule itself.** A grouped field (surface
  `groupBy` axes, json-rules 2.18) narrows its options to the partition selected
  by conjoined sibling clauses on its axes — `equals` pins one key, `in` a union,
  several clauses intersect; only `all` blocks pin; bind/path/unset never pin.
  The pin derives FROM the semantic clauses, so the picker can never promise a
  narrower vocabulary than the rule enforces — and it narrows `enumValues` too,
  so `ValueControl.valid` gates on the pinned set. Cascades (source → field →
  value, country → state) fall out of ordinary authored clauses.
- **`Facet.group` removed** (shipped 0.19.0, unconsumed): the facet's fixed
  `where` IS the sibling that pins, making the static stamp redundant — and its
  where-less form was exactly the unsafe state (picker narrower than semantics)
  the inference forecloses.
- **`matchFacet` collection identity is subset-matched** (order-tolerant): a
  saved or AI-authored block carrying the identity clauses in any order still
  collapses to its facet; when several identities are contained, the most
  specific wins. Positional `lockedLeading` hiding still requires a leading
  identity block.
- **`Facet.selectors`** — declared inner selector rows (`{field, label?,
  anyLabel?}`), surfaced verbatim on a matched `ArrayNode`, so renderers draw
  "Field: [Any ▾]" dropdowns generically instead of hardcoding paths.
- `PickOption.group` → `groups?: string[]`; `BuilderField.groupBy` carries the
  axes. Requires `@inixiative/json-rules ^2.18.0`.

## 0.19.0 — grouped sources reach the picker

- **`BuilderField.options`** — `describeModelFields` now carries the surface's option set verbatim (`{value, label?, group?}`, json-rules ≥ 2.17) instead of flattening it into `enumValues`/`enumLabels` (which remain, derived, for renderers that don't partition). A leaf's `ValueControl.options` carries `group` too, so an undecorated grouped field renders as one sectioned select.
- **`Facet.group`** — a facet may pin its value picker to ONE partition of a grouped source: only options whose `group` matches survive (`options` filtered, `enumValues` re-derived). Presentation only — the group never enters the rule, and identity/rehydration stay path + fixed `where`. This completes the 2-level EAV flow: one facet per custom field, its dropdown auto-populated with exactly that field's values. Multi-group membership is row multiplicity (one option per `(group, value)` pair), never a group array.
- Peer dep raised to `@inixiative/json-rules ^2.17.1` (`SourceOption.group`).

## 0.18.1 — facets lead the picker

- **Facets sort ahead of the anchor model's raw fields** in `useRuleBuilder`'s field list (`[...hoisted, ...anchorFields]`, was the reverse). They are the named, curated entries a decoration exists to surface — the "pre-root" picking layer — so a decorated builder opens on them.
- Example drop-in renderers now demonstrate the renderer contract the types already spec: an array/group with `hoist` collapses to its facet badge (icon + label), `lockedLeading` identity conditions are hidden, and a group's `label` (retagged root or branch-facet name) renders as its title.

## 0.18.0 — `Decoration`/`Facet`: hoist & relabel lens paths into the root selector

- **`Decoration`** — a presentation-only layer over a lens. Each **`Facet`** pre-traverses the lens graph and raises a chosen location up to the builder's root field selector, additive to the anchor model's own fields. Every facet emits its real dotted path (bridges included) as the rule `field`, so json-rules resolves it unchanged — the lens stays the sole source of truth, and absent a `decoration` the surface is byte-for-byte identical.
- **Four facet kinds**, chosen by the path's shape against the lens: **leaf** (a directly rule-able field, incl. bridge-crossing paths like `salesforce:Contact.arr` — other sources reachable at the root); **branch** (a to-one relation → a scoped sub-group whose picker is the related model, leaves emit `account.*` paths); **collection** (a list relation → a top-level array node; nested lists recurse — `orders any (items any (sku …))` — never a flat list-crossing leaf, which json-rules silently mis-evaluates); **preset** (a `condition` instead of a `path` — a named alias for a whole pre-authored rule, dropped in as one atomic node).
- **Two `where`s.** `where` is the facet's fixed identity (leading condition(s), the only thing rehydration matches on); `defaultWhere` is the editable per-boundary array-traversal operator list (one op per list crossed, default `any`). The EAV pattern falls out: `customFields any (key='nps' AND value…)` reads as one field **"NPS"**, with a `kind` override typing the untyped `value` column so operators are correct.
- **Relabeling** keyed structurally (`Model.field`) or by path (path wins); inline `label`/`icon` per facet; `labels.models` retags the root/anchor group and relation fields (`modelDecor`/`relabelRelations`); icons propagate to the picker menu options.
- **Rehydration** — `matchFacet` recognizes a saved node/group as its named facet (by the fixed `where`, else by shared prefix or whole-condition equality) and collapses it back, so a saved aliased rule round-trips to its named entry instead of a raw builder.
- **`validateDecoration`** enforces the collision-free guarantee that makes reverse-matching deterministic: no prefix-related fixed `where`s on a target, no duplicate ids, no unresolvable paths, no `where`/`defaultWhere` on a leaf, presets valid against the lens. `useFacetFields` runs it as a dev-only `console.warn`, so the invariant is enforced by the API, not just the docs. `facetId` canonicalizes the `where` so key order yields stable ids.
- **`decoration` option** on `useRuleBuilder` / `useFilteredCollection`. New exports: types `Decoration`, `Facet`, `Decor`; `describeFacets`, `matchFacet`, `decorationSurfaceOptions`, `useFacetFields`, `validateDecoration`, `facetId`, `consumedTopFields`, `branchFields`, `facetBranchScope`, `facetElementLeaf`, `isPreset`, `leadingWhereCount`, `whereConditions`, `modelDecor`, `relabelRelations`. Requires `@inixiative/json-rules@^2.16.0`.

## 0.17.0 — configurable `empty` scaffold; `setCondition(undefined)` clears

- **`useRuleBuilder({ empty })`** — what an absent `defaultValue` seeds to, replacing the hardcoded `{ all: [] }` (still the default). Lets a consumer scaffold a shaped blank builder — e.g. segments seeding `{ any: [{ all: [] }, { field: 'uuid', operator: 'in', value: [] }] }` for "rule-matched OR hand-picked members". Threads through `useFilteredCollection` via the shared options.
- **`setCondition(undefined)`** reseeds to `empty` — the "clear" gesture, symmetric with the mount seed. `asRoot` gains the `empty` parameter.
- Absence stays `undefined`-only, deliberately: a `null` from a DB row is the caller's to normalize at its own boundary, not a symbol the builder legitimizes (documented on `asRoot`).

## 0.16.0 — `useFilteredCollection` string-match defaults (case-insensitive + slight fuzzy)

- `UseFilteredCollectionOptions` now extends the engine's string settings (`Partial<EngineGlobalsState['string']>` — `caseInsensitive?`, `fuzzy?`), and the filter pass applies them via `engineGlobals.with({ string }, …)`. Defaults to **case-insensitive + slight typo-tolerance** (`{ caseInsensitive: true, fuzzy: { maxRatio: 0.2, maxDistance: 1 } }`): client search shrugs off casing and a single-char typo without any per-rule flags. Override per call (`{ fuzzy: false }` for exact). The override is scoped to the synchronous filter pass — global engine config is untouched. Requires `@inixiative/json-rules@^2.16.0`.

## 0.15.0 — `useFilteredCollection`: the headless builder over a collection in hand

- **`useFilteredCollection({ ...builderOpts, rows, checkOptions? })`** composes `useRuleBuilder` with the in-memory half of the rules duality, for collections fetched whole (calendar ranges, Kanban boards) where the server owns scope and the narrowing is display-only. One `Condition` owner (the builder), one option-folding seam (sourced fields materialize from the rows via json-rules 2.14's `sourceValuesFromRows`, folded through the builder's own `resolve`), stamp-once (the emitted `value` is already coercion-stamped; `data` is `rows.filter(check(value))`). Supersedes per-app filter hooks that double-owned the rule and double-folded `sourceValues` (`@template/ui`'s `useFilteredData`).
- `useRuleBuilder`'s `value` is memoized (was re-minted every render), so downstream `data`/effect memos keyed on it hold.
- `composeNarrowed(source)` extracted from `resolve` — the narrowed lens pre-projection, shared by the projection and the row materializer.
- Peer floor raised to `@inixiative/json-rules@^2.14.0` (`sourceValuesFromRows`).

## 0.14.1 — json-rules ^2.13.1 floor (deterministic DateTime coercion)

- Dependency floor raised to `@inixiative/json-rules@^2.13.1`: naive datetime strings anchor UTC during `coerceType: 'DateTime'` evaluation (2.13.0's tarball missed the fix).

## 0.14.0 — emit coercion-stamped rules (json-rules 2.13 `coerceType`)

- **`useRuleBuilder` emits coercion-stamped rules.** The cleaned output (`value`, `onChange`, `validate`, `describe`) runs json-rules 2.13's `stampCoercions` against the composed lens, so every field rule carries `coerceType` from its field kind — `check()` then compares widget-authored values (date strings, stringified numbers/booleans) against wire-format rows with no type inference. Array/aggregate nested conditions stamp against the related model; a seeded `coerceType` is preserved. Requires `@inixiative/json-rules@^2.13.0`.
- Not yet stamped: the permission/transition algebras' ABAC `rule` leaves (`useActionRuleBuilder`, `usePermissionBuilder`, `useTransitionBuilder`) — their leaves re-anchor on per-resource lenses, so stamping belongs at the leaf commit with the leaf's own lens.

## 0.13.0 — bind value-source, json-rules 2.12 option adoption, hooks tested

- **Bind value-source in the rule builder** + reference renderers: a rule value can bind to context (the `{ bind }` value source), surfaced by the copy-paste reference renderers.
- **Adopt json-rules 2.12's labeled option sets.** `runSources` emits `SourceValues.options` (`{ value, label? }[]`) instead of `values: string[]`, and `describeModelFields` reads a field's selectable set from `entry.options` (folded via json-rules), so sourced fields carry human labels in the picker. The example's narrowing editor handles the `Condition | SourceSpec` union. Requires `@inixiative/json-rules@^2.12.1`.
- **Fix:** calling `remove()` on a bare array-root node no longer throws (`removeNode: cannot remove the root`) — it clears to the empty group, mirroring the leaf-root behavior. Also fixes the junk `"undefined"` node id at the array root.
- **Tests:** lifecycle coverage for all five hooks (`useRuleBuilder`, `useActionRuleBuilder`, `usePermissionBuilder`, `useTransitionBuilder`, `useLensValuePicker`) — seed-once/controlled semantics, `onChange` suppression, descriptor-tree actions, and memo stability (+42 tests, 176 total).
