import {
  type Condition,
  describeRule,
  type Lens,
  type RuleDescription,
  type RuleTarget,
  stampCoercions,
  validateRule,
} from '@inixiative/json-rules';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stripMeta, trimEmptyGroups, withIds } from '../core/decorate';
import {
  consumedTopFields,
  type Decoration,
  decorationSurfaceOptions,
  relabelRelations,
  stampFacetIds,
  useFacetFields,
} from '../schema/decoration';
import { describeModelFields, type RuleBuilderSource, resolve } from '../schema/surface';
import { asRoot, type BuilderNode, buildRoot } from './buildNodes';

const EMPTY: Condition = { all: [] };

export type UseRuleBuilderOptions = {
  source: RuleBuilderSource;
  /** Fetched option sets for the source's sourced fields → folded onto field.values. */
  sourceValues?: import('@inixiative/json-rules').SourceValues[];
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
export type UseRuleBuilder = {
  value: Condition;
  root: BuilderNode;
  lens: Lens;
  /** Reseed the tree. `undefined` reseeds to `empty` — the "clear" gesture. */
  setCondition: (clean: Condition | undefined) => void;
  validate: (target: RuleTarget) => ReturnType<typeof validateRule>;
  describe: () => RuleDescription;
};

export const useRuleBuilder = (opts: UseRuleBuilderOptions): UseRuleBuilder => {
  const lens = useMemo(
    () => resolve(opts.source, { sourceValues: opts.sourceValues }),
    [opts.source, opts.sourceValues],
  );
  const surfaceOpts = useMemo(() => {
    const fromDecoration = decorationSurfaceOptions(opts.decoration);
    return {
      targets: opts.targets,
      labels: { ...fromDecoration.labels, ...opts.labels },
      valueLabels: { ...fromDecoration.valueLabels, ...opts.valueLabels },
    };
  }, [opts.decoration, opts.targets, opts.labels, opts.valueLabels]);
  const anchorFields = useMemo(() => {
    const all = relabelRelations(
      describeModelFields(lens, lens.mapName, lens.model, surfaceOpts),
      opts.decoration,
    );
    const consumed = consumedTopFields(opts.decoration);
    return consumed.size ? all.filter((f) => !consumed.has(f.name)) : all;
  }, [lens, surfaceOpts, opts.decoration]);
  const hoisted = useFacetFields(lens, opts.decoration, surfaceOpts);
  // Facets lead the picker: they are the named, curated entries a decoration exists
  // to surface, so they sort ahead of the anchor model's raw fields.
  const fields = useMemo(
    () => (hoisted.length ? [...hoisted, ...anchorFields] : anchorFields),
    [anchorFields, hoisted],
  );
  const maxDepth = opts.maxDepth ?? 4;

  // Ingest: a condition entering the builder is recognized once — every facet
  // node stamped with its id (`__facetId`) — then id-tracked for the session.
  const ingest = (c: Condition | undefined): Condition => {
    const rooted = asRoot(c, opts.empty);
    return withIds(opts.decoration ? stampFacetIds(rooted, lens, opts.decoration) : rooted);
  };
  const [tree, setTree] = useState<Condition>(() => ingest(opts.defaultValue));

  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const first = useRef(true);

  // Emitted rules carry their coercion: coerceType is stamped from the lens's field
  // kinds so check() compares widget-authored values (date strings, stringified
  // numbers) against wire-format rows without inferring types.
  const clean = useCallback(
    (t: Condition): Condition => stampCoercions(stripMeta(trimEmptyGroups(t) ?? EMPTY), lens),
    [lens],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current?.(clean(tree));
  }, [tree, clean]);

  const commit = useCallback((next: Condition) => setTree(withIds(next)), []);
  const root = useMemo(
    () =>
      buildRoot(tree, lens, fields, maxDepth, commit, { decoration: opts.decoration, surfaceOpts }),
    [tree, lens, fields, maxDepth, commit, opts.decoration, surfaceOpts],
  );
  const value = useMemo(() => clean(tree), [tree, clean]);

  return {
    value,
    root,
    lens,
    setCondition: (c) => setTree(ingest(c)),
    validate: (target) => validateRule(value, { target }),
    describe: () => describeRule(value, lens),
  };
};
