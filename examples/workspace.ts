import {
  type Bridge,
  type Condition,
  createLens,
  type FieldMap,
  type Lens,
  type LensNarrowing,
} from '@inixiative/json-rules';
import type { Decoration, ResourcePermission, SavedRule, TransitionMap } from '../src';

/** A narrowing's parent — a lens or another narrowing, by name. */
export type ParentRef = { kind: 'lens' | 'narrowing'; name: string };

/** A lens: which fieldMaps it spans (`maps`), an anchor (map.model), + attached bridges.
 *  The base reference view — no restrictions. `maps` omitted = every workspace map. */
export type SavedLens = {
  mapName: string;
  model: string;
  maps?: string[];
  bridges?: Bridge[];
};

/** A narrowing: picks a parent (lens or narrowing) + a restriction chain (picks/omits/where/enum/sources/relations).
 *  Restricts the parent's exposed surface — never widens. Chains. */
export type SavedNarrowing = {
  parent: ParentRef;
  narrowing: Omit<LensNarrowing, 'parent'>;
};

/** A saved rule keeps its source binding by reference + its captured sourced option-sets. */
export type SavedWsRule = SavedRule<ParentRef>;

export const DEFAULT_MAX_DEPTH = 4;

export type Workspace = {
  maps: Record<string, FieldMap>;
  bridges: Bridge[];
  lenses: Record<string, SavedLens>;
  narrowings: Record<string, SavedNarrowing>;
  rule: Condition; // the working draft in the builder
  rules: Record<string, SavedWsRule>; // saved, named rules (ref-bound + captured values)
  decorations: Record<string, Decoration>; // saved, named display decorations
  permissions: Record<string, ResourcePermission>; // resource (`map:model`) → { actions } — emitted schema's `permissions`; bridges come from `bridges` above
  transitions: TransitionMap; // resource (`map:model`) → action → Action (from/to edges)
  maxDepth: number; // builder nesting depth — applies to every rule field
};

export const emptyWorkspace = (): Workspace => ({
  maps: {},
  bridges: [],
  lenses: {},
  narrowings: {},
  rule: { all: [] },
  rules: {},
  decorations: {},
  permissions: {},
  transitions: {},
  maxDepth: DEFAULT_MAX_DEPTH,
});

/** Narrowing names in `name`'s parent chain (its ancestors). Used to keep the
 *  parent picker from offering a narrowing's own descendants (cycle guard). */
export const narrowingAncestors = (
  ws: Workspace,
  name: string,
  seen: Set<string> = new Set(),
): Set<string> => {
  const out = new Set<string>();
  const n = ws.narrowings[name];
  if (!n || seen.has(name)) return out;
  const next = new Set(seen).add(name);
  if (n.parent.kind === 'narrowing') {
    out.add(n.parent.name);
    for (const a of narrowingAncestors(ws, n.parent.name, next)) out.add(a);
  }
  return out;
};

/** The createLens input for a saved lens: maps filtered to those it includes (always its
 *  anchor), and bridges kept only when both endpoints' maps are included. */
export const lensInput = (ws: Workspace, l: SavedLens) => {
  const include = l.maps?.length ? new Set([...l.maps, l.mapName]) : null;
  const maps = include
    ? Object.fromEntries(Object.entries(ws.maps).filter(([m]) => include.has(m)))
    : ws.maps;
  const bridges = (l.bridges ?? []).filter((b) =>
    b.endpoints.every((e) => !include || include.has(e.fieldMap)),
  );
  return { maps, bridges, mapName: l.mapName, model: l.model };
};

/** Resolve a parent ref to a usable Lens | LensNarrowing, recursively through the chain. */
export const resolveRef = (
  ws: Workspace,
  ref: ParentRef,
  seen: Set<string> = new Set(),
): Lens | LensNarrowing | null => {
  const key = `${ref.kind}:${ref.name}`;
  if (seen.has(key)) return null; // cycle guard
  const next = new Set(seen).add(key);
  if (ref.kind === 'lens') {
    const l = ws.lenses[ref.name];
    if (!l) return null;
    return createLens(lensInput(ws, l));
  }
  const n = ws.narrowings[ref.name];
  if (!n) return null;
  const parent = resolveRef(ws, n.parent, next);
  if (!parent) return null;
  return { parent, ...n.narrowing };
};

export const exportWorkspace = (ws: Workspace): string => JSON.stringify(ws, null, 2);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const importWorkspace = (json: string): Workspace => {
  const parsed: unknown = JSON.parse(json);
  if (!isPlainObject(parsed)) throw new Error('importWorkspace: root must be an object');
  const ws = emptyWorkspace();

  if ('maps' in parsed) {
    if (!isPlainObject(parsed.maps)) throw new Error('importWorkspace: maps must be an object');
    ws.maps = parsed.maps as Record<string, FieldMap>;
  }
  if ('bridges' in parsed) {
    if (!Array.isArray(parsed.bridges))
      throw new Error('importWorkspace: bridges must be an array');
    ws.bridges = parsed.bridges as Bridge[];
  }
  if ('lenses' in parsed) {
    if (!isPlainObject(parsed.lenses)) throw new Error('importWorkspace: lenses must be an object');
    ws.lenses = parsed.lenses as Record<string, SavedLens>;
  }
  if ('narrowings' in parsed) {
    if (!isPlainObject(parsed.narrowings))
      throw new Error('importWorkspace: narrowings must be an object');
    ws.narrowings = parsed.narrowings as Record<string, SavedNarrowing>;
  }
  if ('rule' in parsed && parsed.rule !== undefined) {
    ws.rule = parsed.rule as Condition;
  }
  if ('rules' in parsed && isPlainObject(parsed.rules)) {
    ws.rules = parsed.rules as Record<string, SavedWsRule>;
  }
  if ('decorations' in parsed && isPlainObject(parsed.decorations)) {
    ws.decorations = parsed.decorations as Record<string, Decoration>;
  }
  if ('permissions' in parsed && isPlainObject(parsed.permissions)) {
    ws.permissions = parsed.permissions as Record<string, ResourcePermission>;
  }
  if ('transitions' in parsed && isPlainObject(parsed.transitions)) {
    ws.transitions = parsed.transitions as TransitionMap;
  }
  if ('maxDepth' in parsed && typeof parsed.maxDepth === 'number') {
    ws.maxDepth = parsed.maxDepth;
  }
  return ws;
};
