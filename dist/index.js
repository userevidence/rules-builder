// src/builder/buildNodes.ts
import {
  checkRuleAgainstLens as checkRuleAgainstLens2,
  createLens as createLens3,
  exposedSurface as exposedSurface3
} from "@inixiative/json-rules";

// src/core/decorate.ts
var isObj = (c) => typeof c === "object" && c !== null;
var groupKey = (c) => Array.isArray(c.all) ? "all" : Array.isArray(c.any) ? "any" : void 0;
var groupChildren = (c, key) => c[key];
var groupMeta = (node) => {
  if (!isObj(node)) return {};
  const { all: _all, any: _any, ...rest } = node;
  return rest;
};
var switchGroupOperator = (node, kind) => {
  if (!isObj(node)) throw new Error("switchGroupOperator: not a compound");
  const rec = node;
  const key = groupKey(rec);
  if (!key) throw new Error("switchGroupOperator: node is not an all/any compound");
  return { [kind]: groupChildren(rec, key), ...groupMeta(node) };
};
var SUB_CONDITION_KEYS = ["condition", "filter"];
var trimEmptyGroups = (node) => {
  if (!isObj(node)) return node;
  const rec = node;
  const key = groupKey(rec);
  if (!key) {
    let next;
    for (const sub of SUB_CONDITION_KEYS) {
      if (!isObj(rec[sub])) continue;
      const trimmed = trimEmptyGroups(rec[sub]);
      if (trimmed === rec[sub]) continue;
      next = next ?? { ...rec };
      if (trimmed === void 0) delete next[sub];
      else next[sub] = trimmed;
    }
    return next ?? node;
  }
  const kept = groupChildren(rec, key).map(trimEmptyGroups).filter((c) => c !== void 0);
  if (kept.length === 0) return void 0;
  return { [key]: kept, ...groupMeta(node) };
};
var stripMeta = (node) => {
  if (!isObj(node)) return node;
  if (Array.isArray(node)) return node.map((x) => stripMeta(x));
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("_")) continue;
    out[k] = stripMeta(v);
  }
  return out;
};
var defaultMakeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
var withIds = (node, makeId = defaultMakeId) => {
  if (!isObj(node)) return node;
  const rec = node;
  const key = groupKey(rec);
  if (key) {
    const next2 = { ...rec, [key]: groupChildren(rec, key).map((c) => withIds(c, makeId)) };
    if (next2.__groupId === void 0) next2.__groupId = makeId();
    return next2;
  }
  const next = { ...rec };
  for (const sub of SUB_CONDITION_KEYS) {
    if (isObj(next[sub])) next[sub] = withIds(next[sub], makeId);
  }
  if (next.__id === void 0) next.__id = makeId();
  return next;
};

// src/core/tree.ts
var isObj2 = (c) => typeof c === "object" && c !== null;
var isAll = (c) => isObj2(c) && "all" in c && Array.isArray(c.all);
var isAny = (c) => isObj2(c) && "any" in c && Array.isArray(c.any);
var childArray = (c) => isAll(c) ? c.all : isAny(c) ? c.any : void 0;
var withChildArray = (c, next) => isAll(c) ? { ...c, all: next } : { ...c, any: next };
var getNode = (cond, path) => {
  let cur = cond;
  for (const seg of path) {
    if (cur === void 0 || !isObj2(cur)) return void 0;
    if (typeof seg === "number") {
      const arr = childArray(cur);
      cur = arr?.[seg];
    } else {
      cur = cur[seg];
    }
  }
  return cur;
};
var setNode = (cond, path, node) => {
  if (path.length === 0) return node;
  const [seg, ...rest] = path;
  if (!isObj2(cond)) throw new Error(`setNode: path segment '${seg}' has no object to descend into`);
  if (typeof seg === "number") {
    const arr = childArray(cond);
    if (!arr) throw new Error(`setNode: numeric segment ${seg} but node is not all/any`);
    const next = arr.slice();
    next[seg] = setNode(arr[seg], rest, node);
    return withChildArray(cond, next);
  }
  const record = cond;
  return {
    ...record,
    [seg]: setNode(record[seg], rest, node)
  };
};
var removeNode = (cond, path) => {
  if (path.length === 0) throw new Error("removeNode: cannot remove the root");
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getNode(cond, parentPath);
  if (parent === void 0 || !isObj2(parent))
    throw new Error("removeNode: parent path does not resolve");
  if (typeof key === "number") {
    const arr = childArray(parent);
    if (!arr) throw new Error("removeNode: parent is not all/any");
    return setNode(
      cond,
      parentPath,
      withChildArray(
        parent,
        arr.filter((_, i) => i !== key)
      )
    );
  }
  if (key === "else") {
    const { else: _omit, ...rest } = parent;
    return setNode(cond, parentPath, rest);
  }
  throw new Error(`removeNode: segment '${key}' is required and cannot be removed`);
};
var addRule = (cond, parentPath, node) => {
  const parent = getNode(cond, parentPath);
  if (parent === void 0 || !isAll(parent) && !isAny(parent)) {
    throw new Error("addRule: parent must be an all/any compound");
  }
  const arr = childArray(parent);
  return setNode(cond, parentPath, withChildArray(parent, [...arr, node]));
};
var wrapInCompound = (cond, path, kind) => {
  const node = getNode(cond, path);
  if (node === void 0) throw new Error("wrapInCompound: path does not resolve");
  const wrapped = kind === "all" ? { all: [node] } : { any: [node] };
  return setNode(cond, path, wrapped);
};
var groupSiblings = (cond, parentPath, indices, kind) => {
  const parent = getNode(cond, parentPath);
  if (parent === void 0 || !isAll(parent) && !isAny(parent)) {
    throw new Error("groupSiblings: parent must be an all/any compound");
  }
  const arr = childArray(parent);
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("groupSiblings: no indices selected");
  if (sorted.some((i) => i < 0 || i >= arr.length))
    throw new Error("groupSiblings: index out of range");
  const selected = new Set(sorted);
  const group = kind === "all" ? { all: sorted.map((i) => arr[i]) } : { any: sorted.map((i) => arr[i]) };
  const next = [];
  for (let i = 0; i < arr.length; i++) {
    if (i === sorted[0]) next.push(group);
    if (!selected.has(i)) next.push(arr[i]);
  }
  return setNode(cond, parentPath, withChildArray(parent, next));
};
var unwrapCompound = (cond, path) => {
  const node = getNode(cond, path);
  if (node === void 0) throw new Error("unwrapCompound: path does not resolve");
  const children = childArray(node);
  if (!children) throw new Error("unwrapCompound: node is not an all/any compound");
  if (path.length === 0) {
    if (children.length !== 1)
      throw new Error("unwrapCompound: cannot dissolve a multi-child root");
    return children[0];
  }
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];
  const parent = getNode(cond, parentPath);
  if (typeof key === "number" && parent !== void 0 && (isAll(parent) || isAny(parent))) {
    const arr = childArray(parent);
    const next = [...arr.slice(0, key), ...children, ...arr.slice(key + 1)];
    return setNode(cond, parentPath, withChildArray(parent, next));
  }
  if (children.length !== 1) {
    throw new Error("unwrapCompound: a single-slot parent can only take a single-child compound");
  }
  return setNode(cond, path, children[0]);
};

// src/schema/decoration.ts
import {
  checkRuleAgainstLens,
  createLens as createLens2,
  exposedSurface as exposedSurface2
} from "@inixiative/json-rules";
import { useEffect, useMemo } from "react";

// src/builder/nodes.ts
var isGroupNode = (n) => typeof n === "object" && n !== null && ("all" in n || "any" in n);
var isArrayNode = (n) => typeof n === "object" && n !== null && "arrayOperator" in n;
var isAggregateNode = (n) => typeof n === "object" && n !== null && "aggregate" in n;
var groupOperatorOf = (n) => typeof n === "object" && n !== null && "any" in n ? "any" : "all";
var groupChildrenOf = (n) => {
  const r = n;
  return Array.isArray(r.all) ? r.all : Array.isArray(r.any) ? r.any : [];
};
var firstOperator = (field) => {
  if (field.operators.date.length > 0) return { key: "dateOperator", op: field.operators.date[0] };
  if (field.operators.field.length > 0) return { key: "operator", op: field.operators.field[0] };
  return null;
};
var ruleForField = (field, keepId) => {
  const id = keepId ? { __id: keepId } : {};
  if (field.seed) return { ...field.seed, ...id };
  if (field.isList) return { field: field.name, arrayOperator: "notEmpty", ...id };
  const first = firstOperator(field);
  if (!first) return { field: field.name, operator: "equals", value: "", ...id };
  return { field: field.name, [first.key]: first.op, value: "", ...id };
};
var defaultRule = (fields) => {
  const scalar = fields.find((f) => firstOperator(f) !== null);
  if (scalar) return ruleForField(scalar);
  const list = fields.find((f) => f.isList);
  if (list) return ruleForField(list);
  return fields[0] ? ruleForField(fields[0]) : { field: "", operator: "equals", value: "" };
};

// src/schema/surface.ts
import {
  ALL_KINDS,
  createLens,
  exposedSurface,
  getArrayOperators,
  getOperatorsForKind,
  getValueShape,
  NUMERIC_KINDS
} from "@inixiative/json-rules";
var composeNarrowed = (source) => {
  const lens = createLens({
    maps: source.maps,
    bridges: source.bridges,
    mapName: source.mapName,
    model: source.model
  });
  return source.narrowing ? { parent: lens, ...source.narrowing } : lens;
};
var resolve = (source, opts = {}) => exposedSurface(composeNarrowed(source), { sourceValues: opts.sourceValues });
var RELATION_KINDS = /* @__PURE__ */ new Set(["object", "bridge"]);
var KNOWN_KINDS = new Set(ALL_KINDS);
var toFieldKind = (type) => KNOWN_KINDS.has(type) ? type : "String";
var relationTarget = (entry, currentMap) => {
  if (entry.kind === "object") return { mapName: currentMap, modelName: entry.type };
  if (entry.kind === "bridge") {
    const [m, n] = entry.type.includes(":") ? entry.type.split(":") : [currentMap, entry.type];
    return { mapName: m, modelName: n };
  }
  return void 0;
};
var supportedByAllTargets = (op, targets, perTarget) => {
  if (!targets || targets.length === 0) return true;
  return targets.every((t) => perTarget(t).includes(op));
};
var fieldAndDateOperators = (kind, targets) => {
  const base = getOperatorsForKind(kind);
  const field = base.field.filter(
    (op) => supportedByAllTargets(op, targets, (t) => getOperatorsForKind(kind, t).field)
  );
  const date = base.date.filter(
    (op) => supportedByAllTargets(op, targets, (t) => getOperatorsForKind(kind, t).date)
  );
  return { field, date };
};
var arrayOperators = (targets) => getArrayOperators().filter(
  (op) => supportedByAllTargets(op, targets, (t) => getArrayOperators(t))
);
var mergeOptionLabels = (options, overrides) => {
  const fromOptions = options?.reduce((acc, o) => {
    if (o.label !== void 0 && o.label !== o.value) acc[o.value] = o.label;
    return acc;
  }, {});
  const merged = { ...fromOptions, ...overrides };
  return Object.keys(merged).length ? merged : void 0;
};
var operatorsForKind = (kind, targets) => ({
  ...fieldAndDateOperators(kind, targets),
  array: []
});
var describeModelFields = (lens, mapName, modelName, opts = {}) => {
  const model = lens.maps[mapName]?.models[modelName];
  if (!model) return [];
  const out = [];
  for (const [name, entry] of Object.entries(model.fields)) {
    const isRelation = RELATION_KINDS.has(entry.kind);
    const isList = entry.isList === true;
    const kind = entry.kind === "enum" ? "Enum" : toFieldKind(entry.type);
    const isNumericScalar = entry.kind === "scalar" && NUMERIC_KINDS.includes(kind);
    const isJsonScalar = entry.kind === "scalar" && kind === "Json";
    const aggregatable = isNumericScalar || isJsonScalar;
    const operators = isRelation ? {
      field: [],
      date: [],
      array: isList ? arrayOperators(opts.targets) : []
    } : { ...fieldAndDateOperators(kind, opts.targets), array: [] };
    out.push({
      name,
      label: opts.labels?.[`${modelName}.${name}`] ?? opts.labels?.[name] ?? name,
      kind,
      isList,
      isBridge: entry.kind === "bridge",
      relation: isRelation ? relationTarget(entry, mapName) : void 0,
      operators,
      options: entry.options,
      groupBy: entry.groupBy,
      enumValues: entry.options?.map((o) => o.value) ?? entry.values,
      enumLabels: mergeOptionLabels(
        entry.options,
        opts.valueLabels?.[`${modelName}.${name}`] ?? opts.valueLabels?.[name]
      ),
      acceptsSubPath: kind === "Json",
      aggregatable: aggregatable || void 0,
      compilesToPrisma: aggregatable ? isNumericScalar : void 0
    });
  }
  return out;
};
var valueShapeForOperator = (operator) => getValueShape(operator);

// src/schema/decoration.ts
var isPreset = (facet) => facet.condition !== void 0;
var RELATION_KINDS2 = /* @__PURE__ */ new Set(["object", "bridge"]);
var resolvePath = (lens, path) => {
  if (!path) return void 0;
  const segments = path.split(".");
  let mapName = lens.mapName;
  let modelName = lens.model;
  for (let i = 0; i < segments.length; i++) {
    const entry = lens.maps[mapName]?.models[modelName]?.fields[segments[i]];
    if (!entry) return void 0;
    if (entry.isList) {
      const target2 = relationTarget(entry, mapName);
      if (!target2) return void 0;
      return {
        kind: "collection",
        listOwner: { mapName, modelName },
        listField: segments[i],
        listPath: segments.slice(0, i + 1).join("."),
        target: target2,
        elementLeaf: segments.slice(i + 1).join(".") || void 0
      };
    }
    if (i === segments.length - 1) {
      if (RELATION_KINDS2.has(entry.kind)) {
        const target2 = relationTarget(entry, mapName);
        return target2 ? { kind: "branch", prefix: path, target: target2 } : void 0;
      }
      return { kind: "leaf", mapName, modelName, field: segments[i] };
    }
    const target = relationTarget(entry, mapName);
    if (!target) return void 0;
    mapName = target.mapName;
    modelName = target.modelName;
  }
  return void 0;
};
var whereConditions = (where) => {
  if (!where) return [];
  const all = where.all;
  return Array.isArray(all) ? all : [where];
};
var pickDecor = (dict, ...keys) => {
  if (dict) {
    for (const key of keys) if (dict[key]) return dict[key];
  }
  return {};
};
var modelDecor = (decoration, mapName, modelName) => pickDecor(decoration?.labels?.models, `${mapName}:${modelName}`, modelName);
var relabelRelations = (fields, decoration) => {
  if (!decoration?.labels?.models) return fields;
  return fields.map((f) => {
    if (!f.relation) return f;
    const decor = modelDecor(decoration, f.relation.mapName, f.relation.modelName);
    return decor.label ? { ...f, label: decor.label, icon: f.icon ?? decor.icon } : f;
  });
};
var modelFacets = (decoration, mapName, modelName) => decoration?.models?.[`${mapName}:${modelName}`] ?? decoration?.models?.[modelName] ?? [];
var scopedDecoration = (decoration, mapName, modelName) => {
  const facets = modelFacets(decoration, mapName, modelName);
  if (!facets.length) return void 0;
  return { facets, models: decoration?.models, labels: decoration?.labels };
};
var scopedFacetId = (lens, facet) => `${lens.mapName}:${lens.model}/${facetId(facet)}`;
var facetId = (facet) => {
  if (facet.condition !== void 0) return `#preset:${JSON.stringify(canonical(facet.condition))}`;
  return facet.where ? `${facet.path}#${JSON.stringify(canonical(facet.where))}` : facet.path ?? "";
};
var isMetaKey = (key) => key === "coerceType" || key.startsWith("_");
var canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort())
      if (!isMetaKey(key)) out[key] = canonical(value[key]);
    return out;
  }
  return value;
};
var sameConditions = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
var isLeadingPrefix = (lead, conds) => lead.length <= conds.length && sameConditions(lead, conds.slice(0, lead.length));
var isSubset = (lead, conds) => {
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
var buildLeafField = (lens, facet, resolved, fieldDecor, opts) => {
  if (facet.path === void 0) return void 0;
  const base = describeModelFields(lens, resolved.mapName, resolved.modelName, opts).find(
    (f) => f.name === resolved.field
  );
  if (!base) return void 0;
  const decor = pickDecor(
    fieldDecor,
    facet.path,
    `${resolved.mapName}:${resolved.modelName}.${resolved.field}`,
    `${resolved.modelName}.${resolved.field}`
  );
  return {
    ...base,
    name: facet.path,
    label: facet.label ?? decor.label ?? base.label,
    icon: facet.icon ?? decor.icon
  };
};
var facetElementLeaf = (lens, facet, opts = {}) => {
  const resolved = resolvePath(lens, facet.path);
  if (resolved?.kind !== "collection" || !resolved.elementLeaf) return void 0;
  const leaf = describeModelFields(
    lens,
    resolved.target.mapName,
    resolved.target.modelName,
    opts
  ).find((f) => f.name === resolved.elementLeaf);
  if (!leaf) return void 0;
  return facet.kind ? { ...leaf, kind: facet.kind, operators: operatorsForKind(facet.kind, opts.targets) } : leaf;
};
var leadingWhereCount = (facet, node) => {
  const lead = whereConditions(facet.where);
  if (lead.length === 0) return 0;
  const rec = node;
  const conds = rec.condition ? rec.condition.all ?? [] : rec.all ?? [];
  return isLeadingPrefix(lead, conds) ? lead.length : 0;
};
var selectorClauseField = (facet, cond) => {
  if (!cond || typeof cond !== "object") return void 0;
  if ("arrayOperator" in cond || "aggregate" in cond) return void 0;
  const declared = (field) => (facet.selectors ?? []).some((s) => s.field === field);
  if ("field" in cond) {
    const field = cond.field;
    return declared(field) ? field : void 0;
  }
  const kids = groupChildren2(cond);
  if (!kids?.length) return void 0;
  const first = kids[0]?.field;
  if (!declared(first)) return void 0;
  const uniform = kids.every(
    (c) => c && typeof c === "object" && !("arrayOperator" in c) && !("aggregate" in c) && c.field === first
  );
  return uniform ? first : void 0;
};
var isSelectorClause = (facet, cond) => selectorClauseField(facet, cond) !== void 0;
var selectorClauseAt = (facet, conds, index) => {
  const cond = conds[index];
  if (!cond || index === conds.length - 1) return void 0;
  return selectorClauseField(facet, cond);
};
var collectionSingleHop = (lens, resolved) => {
  let { mapName, modelName } = resolved.target;
  for (const seg of resolved.elementLeaf?.split(".") ?? []) {
    const entry = lens.maps[mapName]?.models[modelName]?.fields[seg];
    if (!entry) return true;
    if (entry.isList) return false;
    const target = relationTarget(entry, mapName);
    if (!target) return true;
    mapName = target.mapName;
    modelName = target.modelName;
  }
  return true;
};
var selectorsApply = (lens, facet) => {
  if (!facet.selectors?.length || isPreset(facet)) return false;
  const resolved = resolvePath(lens, facet.path);
  if (!resolved) return false;
  if (resolved.kind === "branch") return true;
  return resolved.kind === "collection" && collectionSingleHop(lens, resolved);
};
var leadingIdentityCount = (lens, facet, node) => {
  if (!selectorsApply(lens, facet)) return leadingWhereCount(facet, node);
  const whereLead = whereConditions(facet.where);
  const rec = node;
  const conds = rec.condition ? rec.condition.all ?? [] : rec.all ?? [];
  if (whereLead.length > 0 && !isLeadingPrefix(whereLead, conds)) return 0;
  let count = whereLead.length;
  const seen = /* @__PURE__ */ new Set();
  while (count < conds.length) {
    const field = selectorClauseAt(facet, conds, count);
    if (field === void 0 || seen.has(field)) break;
    seen.add(field);
    count += 1;
  }
  return count;
};
var branchFields = (lens, prefix, target, opts = {}) => {
  const out = [];
  const walk = (mapName, modelName, at, seen) => {
    const key = `${mapName}:${modelName}`;
    if (seen.has(key)) return;
    const nextSeen = /* @__PURE__ */ new Set([...seen, key]);
    for (const f of describeModelFields(lens, mapName, modelName, opts)) {
      const name = `${at}.${f.name}`;
      if (f.isList) {
        out.push({ ...f, name });
      } else if (f.relation) {
        walk(f.relation.mapName, f.relation.modelName, name, nextSeen);
      } else {
        out.push({ ...f, name });
      }
    }
  };
  walk(target.mapName, target.modelName, prefix, /* @__PURE__ */ new Set());
  return out;
};
var facetBranchScope = (lens, facet, opts = {}) => {
  const resolved = resolvePath(lens, facet.path);
  if (resolved?.kind !== "branch") return void 0;
  return {
    prefix: resolved.prefix,
    fields: branchFields(lens, resolved.prefix, resolved.target, opts)
  };
};
var branchSeed = (lens, facet, resolved, opts) => {
  const [first] = branchFields(lens, resolved.prefix, resolved.target, opts);
  const identity = whereConditions(facet.where);
  const rows = first ? [ruleForField(first)] : [];
  return { all: identity.length ? [...identity, { all: rows }] : rows };
};
var pathHasList = (lens, mapName, modelName, segments) => {
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
var leafRuleAt = (lens, mapName, modelName, segments, kind, opts) => {
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
    (f) => f.name === segments[segments.length - 1]
  );
  if (!found) return null;
  const leaf = {
    ...found,
    name: segments.join("."),
    ...kind ? { kind, operators: operatorsForKind(kind, opts.targets) } : {}
  };
  return ruleForField(leaf);
};
var arrayTraversalCount = (lens, path) => {
  if (!path) return 0;
  const segments = path.split(".");
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
var buildCollection = (lens, mapName, modelName, segments, ops, opIndex, where, kind, opts) => {
  let m = mapName;
  let mod = modelName;
  for (let i = 0; i < segments.length; i++) {
    const entry = lens.maps[m]?.models[mod]?.fields[segments[i]];
    if (!entry) return null;
    if (entry.isList) {
      const target2 = relationTarget(entry, m);
      if (!target2) return null;
      const listField = segments.slice(0, i + 1).join(".");
      const rest = segments.slice(i + 1);
      const op = ops[opIndex.i++] ?? "any";
      if (pathHasList(lens, target2.mapName, target2.modelName, rest)) {
        const inner = buildCollection(
          lens,
          target2.mapName,
          target2.modelName,
          rest,
          ops,
          opIndex,
          where,
          kind,
          opts
        );
        return {
          field: listField,
          arrayOperator: op,
          condition: { all: inner ? [inner] : [] }
        };
      }
      const leaf = rest.length ? leafRuleAt(lens, target2.mapName, target2.modelName, rest, kind, opts) : null;
      const identity = whereConditions(where);
      return {
        field: listField,
        arrayOperator: op,
        condition: {
          all: identity.length ? [...identity, { all: leaf ? [leaf] : [] }] : leaf ? [leaf] : []
        }
      };
    }
    const target = relationTarget(entry, m);
    if (!target) return null;
    m = target.mapName;
    mod = target.modelName;
  }
  return null;
};
var collectionSeed = (lens, facet, opts) => buildCollection(
  lens,
  lens.mapName,
  lens.model,
  (facet.path ?? "").split("."),
  facet.defaultWhere ?? [],
  { i: 0 },
  facet.where,
  facet.kind,
  opts
) ?? {
  field: facet.path,
  arrayOperator: facet.defaultWhere?.[0] ?? "any",
  condition: { all: [] }
};
var describeFacets = (lens, decoration, opts = {}) => {
  const out = [];
  const fieldDecor = decoration.labels?.fields;
  const resolverFor = /* @__PURE__ */ new Set();
  for (const facet of decoration.facets) {
    if (facet.condition !== void 0) {
      out.push({
        name: facetId(facet),
        label: facet.label ?? "preset",
        icon: facet.icon,
        kind: "String",
        isList: false,
        isBridge: false,
        operators: { field: [], date: [], array: [] },
        seed: facet.condition
      });
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) continue;
    if (resolved.kind === "leaf") {
      const field = buildLeafField(lens, facet, resolved, fieldDecor, opts);
      if (field) out.push(field);
      continue;
    }
    if (resolved.kind === "branch") {
      out.push({
        name: facetId(facet),
        label: facet.label ?? resolved.prefix,
        icon: facet.icon,
        kind: "String",
        isList: false,
        isBridge: false,
        operators: { field: [], date: [], array: [] },
        seed: branchSeed(lens, facet, resolved, opts)
      });
      continue;
    }
    const id = facetId(facet);
    const isWhole = id === resolved.listPath;
    out.push({
      name: id,
      label: facet.label ?? resolved.elementLeaf ?? resolved.listField,
      icon: facet.icon,
      kind: facet.kind ?? "String",
      isList: true,
      isBridge: false,
      relation: isWhole ? resolved.target : void 0,
      operators: { field: [], date: [], array: [] },
      seed: collectionSeed(lens, facet, opts)
    });
    if (!isWhole && !resolverFor.has(resolved.listPath)) {
      resolverFor.add(resolved.listPath);
      const list = describeModelFields(
        lens,
        resolved.listOwner.mapName,
        resolved.listOwner.modelName,
        opts
      ).find((f) => f.name === resolved.listField);
      if (list) out.push({ ...list, name: resolved.listPath, selectable: false, seed: void 0 });
    }
  }
  return out;
};
var consumedTopFields = (decoration) => {
  const consumed = /* @__PURE__ */ new Set();
  for (const facet of decoration?.facets ?? [])
    if (facet.path && !facet.where && !facet.path.includes(".")) consumed.add(facet.path);
  return consumed;
};
var facetTarget = (lens, facet) => {
  const resolved = resolvePath(lens, facet.path);
  if (!resolved) return void 0;
  return resolved.kind === "collection" ? resolved.listPath : facet.path;
};
var groupChildren2 = (node) => {
  const rec = node;
  return Array.isArray(rec.all) ? rec.all : Array.isArray(rec.any) ? rec.any : void 0;
};
var matchFacet = (lens, decoration, node) => {
  const stamped = node.__facetId;
  if (stamped === null) return void 0;
  if (typeof stamped === "string") {
    const byId = decoration.facets.find((f) => scopedFacetId(lens, f) === stamped);
    if (byId) {
      const { __facetId: _f, ...bare } = node;
      if (matchFacet(lens, { ...decoration, facets: [byId] }, bare)) return byId;
    }
  }
  const rec = node;
  const children = groupChildren2(node);
  const nodeKey = JSON.stringify(canonical(node));
  let best;
  let bestLead = -1;
  for (const facet of decoration.facets) {
    if (facet.condition !== void 0) {
      if (nodeKey === JSON.stringify(canonical(facet.condition))) return facet;
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) continue;
    if (resolved.kind === "leaf") {
      if (rec.field === facet.path && rec.arrayOperator === void 0) return facet;
      continue;
    }
    if (resolved.kind === "branch") {
      if (!children) continue;
      const lead2 = whereConditions(facet.where);
      if (lead2.length > 0) {
        const conjoined = Array.isArray(node.all);
        if (conjoined && isLeadingPrefix(lead2, children)) return facet;
        continue;
      }
      const leaves = children.filter((c) => c && typeof c === "object" && "field" in c);
      if (leaves.length > 0 && leaves.every(
        (c) => String(c.field).startsWith(`${resolved.prefix}.`)
      ))
        return facet;
      continue;
    }
    if (rec.field !== resolved.listPath) continue;
    if (!collectionSingleHop(lens, resolved)) continue;
    const lead = whereConditions(facet.where);
    const destRec = rec.condition;
    const destConds = destRec?.all ?? [];
    if (lead.length === 0) {
      const leafName = resolved.elementLeaf?.split(".").pop();
      const conds = destRec?.all ?? destRec?.any ?? [];
      const isLeafOn = (c) => !!c && typeof c === "object" && c.field === leafName;
      const tail = conds[conds.length - 1];
      const tailRows = tail && typeof tail === "object" ? groupChildren2(tail) ?? [] : [];
      const applies = !resolved.elementLeaf || conds.some(isLeafOn) || tailRows.some(isLeafOn) || selectorsApply(lens, facet) && conds.some((c) => isSelectorClause(facet, c));
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
var stampFacetIds = (condition, lens, decoration) => {
  if (!condition || typeof condition !== "object") return condition;
  let next = { ...condition };
  const key = Array.isArray(next.all) ? "all" : Array.isArray(next.any) ? "any" : void 0;
  if (key) next[key] = next[key].map((c) => stampFacetIds(c, lens, decoration));
  if ((key !== void 0 || "arrayOperator" in next) && next.__facetId === void 0) {
    const facet = matchFacet(lens, decoration, next);
    if (facet) {
      if (!isPreset(facet))
        next = normalizeFacetShape(lens, facet, next);
      next.__facetId = scopedFacetId(lens, facet);
    }
  }
  if ("arrayOperator" in next && next.condition !== void 0) {
    const rel = relationScopeOf(lens, next.field);
    const scoped = rel ? scopedDecoration(decoration, rel.mapName, rel.modelName) : void 0;
    if (rel && scoped) {
      const relLens = exposedSurface2(
        createLens2({ maps: lens.maps, mapName: rel.mapName, model: rel.modelName })
      );
      next.condition = stampFacetIds(next.condition, relLens, scoped);
    }
  }
  return next;
};
var relationScopeOf = (lens, field) => {
  if (!field) return void 0;
  const segments = field.split(".");
  let mapName = lens.mapName;
  let modelName = lens.model;
  for (let i = 0; i < segments.length; i++) {
    const entry = lens.maps[mapName]?.models[modelName]?.fields[segments[i]];
    if (!entry) return void 0;
    const target = relationTarget(entry, mapName);
    if (!target) return void 0;
    if (i === segments.length - 1) return entry.isList ? target : void 0;
    mapName = target.mapName;
    modelName = target.modelName;
  }
  return void 0;
};
var normalizeFacetShape = (lens, facet, node) => {
  const lead = whereConditions(facet.where);
  const selectorFields = selectorsApply(lens, facet) ? (facet.selectors ?? []).map((s) => s.field) : [];
  if (lead.length === 0 && selectorFields.length === 0) return node;
  const canonicalize = (conds) => {
    const rest = [...conds];
    const identity = [];
    for (const clause of lead) {
      const at = rest.findIndex((c) => sameConditions([clause], [c]));
      if (at < 0) return void 0;
      identity.push(...rest.splice(at, 1));
    }
    for (const field of selectorFields) {
      const at = rest.findIndex(
        (c, i) => selectorClauseField(facet, c) === field && !(i === rest.length - 1 && groupChildren2(c) !== void 0)
      );
      if (at >= 0) identity.push(...rest.splice(at, 1));
    }
    if (identity.length === 0) return void 0;
    const tail = rest.length === 1 && rest[0] && groupChildren2(rest[0]) !== void 0 ? rest[0] : { all: rest };
    const next2 = [...identity, tail];
    const unchanged = next2.length === conds.length && next2.every((c, i) => c === conds[i]);
    return unchanged ? void 0 : next2;
  };
  const rec = node;
  if (Array.isArray(rec.all)) {
    const next2 = canonicalize(rec.all);
    return next2 ? { ...rec, all: next2 } : node;
  }
  const cond = rec.condition;
  const cs = cond?.all;
  if (!cs) return node;
  const next = canonicalize(cs);
  return next ? { ...rec, condition: { ...cond, all: next } } : node;
};
var writeSelectorClause = (facet, condition, field, value) => {
  const cond = condition ?? { all: [] };
  const rec = cond;
  const key = Array.isArray(rec.all) ? "all" : Array.isArray(rec.any) ? "any" : void 0;
  const children = key ? [...rec[key]] : [];
  const whereLead = whereConditions(facet.where);
  const whereBlock = key === "all" && whereLead.length > 0 && isLeadingPrefix(whereLead, children) ? whereLead.length : 0;
  const found = key === "all" ? children.findIndex(
    (_c, i) => i >= whereBlock && selectorClauseAt(facet, children, i) === field
  ) : -1;
  if (value === null) {
    if (found < 0 || !key) return cond;
    children.splice(found, 1);
    const only = children[0];
    if (key === "all" && children.length === 1 && only && groupChildren2(only) !== void 0 && whereLead.length === 0 && children.findIndex((_c, i) => selectorClauseAt(facet, children, i) !== void 0) < 0)
      return only;
    return { ...rec, [key]: children };
  }
  const clause = { field, operator: Array.isArray(value) ? "in" : "equals", value };
  if (found >= 0) {
    children[found] = clause;
    return { ...rec, [key]: children };
  }
  if (key !== "all") return { all: [clause, cond] };
  let block = whereBlock;
  const seen = /* @__PURE__ */ new Set();
  while (block < children.length) {
    const nextField = selectorClauseAt(facet, children, block);
    if (nextField === void 0 || seen.has(nextField)) break;
    seen.add(nextField);
    block += 1;
  }
  const identity = children.slice(0, block);
  const rest = children.slice(block);
  const tail = rest.length === 1 && rest[0] && groupChildren2(rest[0]) !== void 0 ? rest[0] : { all: rest };
  return { ...rec, all: [...identity, clause, tail] };
};
var validateDecoration = (lens, decoration) => {
  const violations = validateFacetList(lens, decoration.facets, "");
  for (const [scopeKey, facets] of Object.entries(decoration.models ?? {})) {
    const [mapPart, modelPart] = scopeKey.includes(":") ? scopeKey.split(":", 2) : [void 0, scopeKey];
    const bindings = mapPart ? lens.maps[mapPart]?.models[modelPart] ? [mapPart] : [] : Object.keys(lens.maps).filter((m) => lens.maps[m]?.models[modelPart]);
    if (!bindings.length) {
      violations.push(`models['${scopeKey}'] does not bind to any model in the lens`);
      continue;
    }
    for (const mapName of bindings) {
      const scopeLens = exposedSurface2(createLens2({ maps: lens.maps, mapName, model: modelPart }));
      violations.push(
        ...validateFacetList(
          scopeLens,
          facets,
          `models['${scopeKey}'] @ ${mapName}:${modelPart}: `
        )
      );
    }
  }
  return violations;
};
var validateFacetList = (lens, list, prefix) => {
  const violations = [];
  const ids = /* @__PURE__ */ new Set();
  const byTarget = /* @__PURE__ */ new Map();
  for (const facet of list) {
    if (facet.condition !== void 0) {
      const id2 = facetId(facet);
      if (ids.has(id2)) violations.push(`duplicate facet id '${id2}'`);
      ids.add(id2);
      if (!checkRuleAgainstLens(facet.condition, lens).ok)
        violations.push(`preset '${facet.label ?? id2}' is not a valid rule against the lens`);
      continue;
    }
    const resolved = resolvePath(lens, facet.path);
    if (!resolved) {
      violations.push(`facet '${facet.path}' does not resolve against the lens`);
      continue;
    }
    if (resolved.kind === "leaf" && (facet.where || facet.defaultWhere))
      violations.push(
        `leaf facet '${facet.path}' cannot carry 'where'/'defaultWhere' \u2014 those are collection concepts`
      );
    if (facet.defaultWhere) {
      const need = arrayTraversalCount(lens, facet.path);
      if (facet.defaultWhere.length !== need)
        violations.push(
          `facet '${facet.path}' has ${facet.defaultWhere.length} traversal operator(s) but the path crosses ${need} array boundary(ies)`
        );
    }
    const id = facetId(facet);
    if (ids.has(id)) violations.push(`duplicate facet id '${id}'`);
    ids.add(id);
    const target = facetTarget(lens, facet);
    if (target === void 0) continue;
    const group = byTarget.get(target) ?? [];
    group.push({ facet, lead: whereConditions(facet.where) });
    byTarget.set(target, group);
  }
  for (const [target, group] of byTarget)
    for (let i = 0; i < group.length; i++)
      for (let j = 0; j < group.length; j++)
        if (i !== j && isLeadingPrefix(group[i].lead, group[j].lead)) {
          violations.push(
            `facets on '${target}' collide: '${group[i].facet.label ?? facetId(group[i].facet)}' is a leading prefix of '${group[j].facet.label ?? facetId(group[j].facet)}' \u2014 rehydration would be ambiguous`
          );
          break;
        }
  for (const [target, group] of byTarget)
    for (const a of group)
      for (const b of group) {
        if (a === b || !a.facet.selectors?.length) continue;
        if (!isSubset(a.lead, b.lead)) continue;
        const extras = b.lead.filter((c) => !a.lead.some((l) => sameConditions([l], [c])));
        if (extras.length && extras.every((c) => selectorClauseField(a.facet, c) !== void 0))
          violations.push(
            `facets on '${target}' collide: a '${a.facet.label ?? facetId(a.facet)}' selector pick completes '${b.facet.label ?? facetId(b.facet)}' \u2014 rehydration would flip the pick into fixed identity`
          );
      }
  return violations.map((v) => `${prefix}${v}`);
};
var decorationSurfaceOptions = (decoration) => {
  const labels = {};
  for (const [key, decor] of Object.entries(decoration?.labels?.fields ?? {}))
    if (decor.label !== void 0) labels[key] = decor.label;
  const valueLabels = {};
  for (const [field, values] of Object.entries(decoration?.labels?.values ?? {})) {
    const perValue = {};
    for (const [value, decor] of Object.entries(values))
      if (decor.label !== void 0) perValue[value] = decor.label;
    if (Object.keys(perValue).length) valueLabels[field] = perValue;
  }
  return { labels, valueLabels };
};
var useFacetFields = (lens, decoration, opts = {}) => {
  const fields = useMemo(
    () => decoration ? describeFacets(lens, decoration, opts) : [],
    [lens, decoration, opts.targets, opts.labels, opts.valueLabels]
  );
  useEffect(() => {
    if (!decoration || process.env.NODE_ENV === "production") return;
    const violations = validateDecoration(lens, decoration);
    if (violations.length)
      console.warn(`[rules-builder] invalid Decoration:
- ${violations.join("\n- ")}`);
  }, [lens, decoration]);
  return fields;
};

// src/builder/buildNodes.ts
var axisSiblings = (root, path) => {
  const out = [];
  for (let d = path.length - 1; d >= 0; d--) {
    const parent = getNode(root, path.slice(0, d));
    if (parent === void 0 || !isGroupNode(parent)) break;
    if (groupOperatorOf(parent) === "all")
      out.push(...groupChildrenOf(parent).filter((_, i) => i !== path[d]));
  }
  return out;
};
var pinField = (field, siblings) => {
  if (!field?.groupBy || !field.options) return field;
  const constraints = /* @__PURE__ */ new Map();
  for (const sibling of siblings) {
    if (typeof sibling !== "object" || sibling === null) continue;
    const r = sibling;
    const axis = r.field === void 0 ? -1 : field.groupBy.indexOf(r.field);
    if (axis < 0 || r.value === void 0 || r.value === "") continue;
    const clause = r.operator === "equals" ? /* @__PURE__ */ new Set([String(r.value)]) : r.operator === "in" && Array.isArray(r.value) ? new Set(r.value.map(String)) : void 0;
    if (!clause) continue;
    const prev = constraints.get(axis);
    constraints.set(axis, prev ? new Set([...prev].filter((k) => clause.has(k))) : clause);
  }
  if (constraints.size === 0) return field;
  const options = field.options.filter(
    (o) => o.groups !== void 0 && [...constraints].every(([i, keys]) => o.groups?.[i] !== void 0 && keys.has(o.groups[i]))
  );
  return { ...field, options, enumValues: options.map((o) => o.value) };
};
var COUNT_OPS = /* @__PURE__ */ new Set(["atLeast", "atMost", "exactly"]);
var PREDICATE_OPS = /* @__PURE__ */ new Set(["all", "any", "none"]);
var arrayCat = (op) => op && COUNT_OPS.has(op) ? "count" : op && PREDICATE_OPS.has(op) ? "predicate" : "presence";
var AGGREGATE_MODES = ["sum", "avg"];
var AGGREGATE_OPERATORS = [
  "equals",
  "notEquals",
  "lessThan",
  "lessThanEquals",
  "greaterThan",
  "greaterThanEquals",
  "between"
];
var AGGREGATE_OPERATOR_SET = new Set(AGGREGATE_OPERATORS);
var AGGREGATE_WINDOW_KEYS = ["filter", "orderBy", "take", "skip"];
var validateAggregate = (rec, relationField, targetField) => {
  const agg = rec.aggregate ?? {};
  const fieldTerminatesAtList = relationField?.isList === true && relationField.relation !== void 0;
  const targetExists = targetField !== void 0 && targetField.aggregatable === true;
  const targetCompiles = targetField?.compilesToPrisma === true;
  const operatorOk = typeof rec.operator === "string" && AGGREGATE_OPERATOR_SET.has(rec.operator);
  const modeOk = agg.mode === "sum" || agg.mode === "avg";
  const noWindow = AGGREGATE_WINDOW_KEYS.every((k) => rec[k] === void 0);
  const ok = fieldTerminatesAtList && targetExists && operatorOk && modeOk && noWindow;
  return { ok, compilesToPrisma: ok && targetCompiles };
};
var selectableFields = (fields) => fields.filter((f) => f.selectable !== false && (f.isList || !f.relation));
var idOf = (n, index) => {
  const r = n;
  return r.__groupId ?? r.__id ?? String(index);
};
var buildLeaf = (node, path, depth, ctx, scope) => {
  const id = idOf(node, path.length ? path[path.length - 1] : 0);
  const remove = () => ctx.commit(path.length ? removeNode(ctx.root, path) : { all: [] });
  const setLeafKind = (k) => ctx.commit(setNode(ctx.root, path, k === "boolean" ? true : defaultRule(scope.fields)));
  if (typeof node === "boolean") {
    return {
      kind: "leaf",
      id,
      path,
      depth,
      leafKind: "boolean",
      setLeafKind,
      literal: { value: node, set: (v) => ctx.commit(setNode(ctx.root, path, v)) },
      valid: true,
      remove
    };
  }
  const rec = node;
  const fieldName = rec.field;
  let field = pinField(
    scope.fields.find((f) => f.name === fieldName),
    axisSiblings(ctx.root, path)
  );
  let baseName = fieldName;
  let subPath;
  if (!field && fieldName?.includes(".")) {
    const head = fieldName.slice(0, fieldName.indexOf("."));
    const candidate = scope.fields.find((f) => f.name === head);
    if (candidate?.acceptsSubPath) {
      field = candidate;
      baseName = head;
      subPath = fieldName.slice(head.length + 1);
    }
  }
  const operator = rec.dateOperator ?? rec.operator;
  const operatorOptions = field ? [...field.operators.field, ...field.operators.date].map((o) => ({
    value: o,
    label: o
  })) : [];
  const shape = operator ? valueShapeForOperator(operator) : "none";
  const valueOptions = field?.options ? field.options.map((o) => ({
    value: o.value,
    label: field.enumLabels?.[o.value] ?? o.label ?? o.value,
    groups: o.groups
  })) : field?.enumValues?.map((v) => ({
    value: v,
    label: field.enumLabels?.[v] ?? v
  }));
  const fieldValid = field !== void 0;
  const valueValid = (() => {
    const allowed = field?.enumValues;
    if (!allowed) return true;
    const v = rec.value;
    const vals = Array.isArray(v) ? v : [v];
    return vals.every((x) => x == null || typeof x !== "string" || allowed.includes(x));
  })();
  const valueMode = rec.bind !== void 0 ? "bind" : rec.path !== void 0 ? "path" : "value";
  const leafMatch = scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : void 0;
  const leafHoist = leafMatch ? { id: facetId(leafMatch), label: leafMatch.label ?? baseName ?? "", icon: leafMatch.icon } : void 0;
  return {
    kind: "leaf",
    id,
    path,
    depth,
    leafKind: "field",
    setLeafKind,
    field: {
      value: baseName,
      options: selectableFields(scope.fields).map((f) => ({
        value: f.name,
        label: f.label,
        icon: f.icon
      })),
      set: (name) => {
        const next = scope.fields.find((f) => f.name === name);
        if (next)
          ctx.commit(setNode(ctx.root, path, ruleForField(next, rec.__id)));
      },
      valid: fieldValid,
      acceptsSubPath: field?.acceptsSubPath,
      subPath,
      setSubPath: field?.acceptsSubPath ? (sub) => ctx.commit(
        setNode(ctx.root, path, {
          ...rec,
          field: sub ? `${baseName}.${sub}` : baseName
        })
      ) : void 0
    },
    operator: {
      value: operator,
      options: operatorOptions,
      set: (op) => {
        const isDate = field?.operators.date.includes(op) ?? false;
        const dropOperand = valueShapeForOperator(op) === "none";
        const { operator: _o, dateOperator: _d, value: v, path: p, bind: b, ...rest } = rec;
        ctx.commit(
          setNode(ctx.root, path, {
            ...rest,
            ...dropOperand ? {} : {
              ...v !== void 0 ? { value: v } : {},
              ...p !== void 0 ? { path: p } : {},
              ...b !== void 0 ? { bind: b } : {}
            },
            [isDate ? "dateOperator" : "operator"]: op
          })
        );
      }
    },
    value: {
      current: rec.value,
      shape,
      kind: field?.kind,
      options: valueOptions,
      valid: valueValid,
      set: (value) => ctx.commit(setNode(ctx.root, path, { ...rec, value })),
      mode: valueMode,
      setMode: (m) => {
        if (m === valueMode) return;
        const { value: _v, path: _p, bind: _b, ...rest } = rec;
        const next = m === "path" ? { ...rest, path: rec.path ?? "" } : m === "bind" ? { ...rest, bind: rec.bind ?? "" } : { ...rest, value: rec.value ?? "" };
        ctx.commit(setNode(ctx.root, path, next));
      },
      path: valueMode === "path" ? {
        value: rec.path,
        set: (p) => {
          const { value: _v, bind: _b, ...rest } = rec;
          ctx.commit(setNode(ctx.root, path, { ...rest, path: p }));
        }
      } : void 0,
      bind: valueMode === "bind" ? {
        value: rec.bind,
        set: (name) => {
          const { value: _v, path: _p, ...rest } = rec;
          ctx.commit(setNode(ctx.root, path, { ...rest, bind: name }));
        }
      } : void 0
    },
    hoist: leafHoist,
    atomic: leafMatch && isPreset(leafMatch) ? true : void 0,
    valid: checkRuleAgainstLens2(node, scope.lens).ok,
    remove
  };
};
var buildArray = (node, path, depth, ctx, scope) => {
  const rec = node;
  const fieldName = rec.field;
  const field = scope.fields.find((f) => f.name === fieldName);
  const op = rec.arrayOperator;
  const cat = arrayCat(op);
  const rel = field?.relation;
  const isAggregate = isAggregateNode(node);
  const agg = rec.aggregate ?? {};
  const aggMode = agg.mode === "avg" ? "avg" : "sum";
  const matchedFacet = !isAggregate && scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : void 0;
  const overrideLeaf = matchedFacet ? facetElementLeaf(scope.lens, matchedFacet, ctx.surfaceOpts) : void 0;
  const relScope = rel ? (() => {
    const relLens = exposedSurface3(
      createLens3({
        maps: scope.lens.maps,
        mapName: rel.mapName,
        model: rel.modelName
      })
    );
    const relFields = relabelRelations(
      describeModelFields(relLens, rel.mapName, rel.modelName),
      ctx.decoration
    );
    const fields = overrideLeaf ? relFields.map((f) => f.name === overrideLeaf.name ? { ...f, ...overrideLeaf } : f) : relFields;
    const relDecoration = scopedDecoration(ctx.decoration, rel.mapName, rel.modelName);
    if (!relDecoration) return { lens: relLens, fields };
    const hoisted = describeFacets(relLens, relDecoration, ctx.surfaceOpts);
    const consumed = consumedTopFields(relDecoration);
    return {
      lens: relLens,
      fields: [
        ...hoisted,
        ...consumed.size ? fields.filter((f) => !consumed.has(f.name)) : fields
      ],
      decoration: relDecoration
    };
  })() : scope;
  let selectorClauseNodes;
  const buildSub = (key) => {
    const subRoot = asGroupRoot(rec[key] ?? { all: [] });
    const subScope = key === "condition" && !isAggregate ? relScope : { ...relScope, decoration: void 0 };
    const subCtx = {
      ...ctx,
      root: subRoot,
      commit: (next) => ctx.commit(setNode(ctx.root, path, { ...rec, [key]: next }))
    };
    if (key === "condition" && matchedFacet) {
      const lead = leadingIdentityCount(scope.lens, matchedFacet, node);
      const kids = subRoot.all ?? [];
      const tail = kids[lead];
      if (lead > 0 && kids.length === lead + 1 && tail && isGroupNode(tail)) {
        const whereLead = leadingWhereCount(matchedFacet, node);
        const clauseSlice = kids.slice(whereLead, lead);
        selectorClauseNodes = clauseSlice.length ? clauseSlice.map((clause, i) => {
          const built = buildNode(clause, [whereLead + i], depth + 1, subCtx, subScope);
          const clauseField = clause.field ?? groupChildrenOf(clause)[0]?.field;
          return clauseField ? {
            ...built,
            remove: () => subCtx.commit(writeSelectorClause(matchedFacet, subRoot, clauseField, null))
          } : built;
        }) : void 0;
        return {
          ...buildGroup(tail, [lead], depth + 1, subCtx, subScope),
          // The rows group is the outer facet's surface: not removable, never re-badged.
          remove: void 0,
          hoist: void 0,
          atomic: void 0,
          facetMode: void 0,
          selectors: void 0,
          selectorClauses: void 0,
          setSelectorClause: void 0
        };
      }
    }
    return buildGroup(subRoot, [], depth + 1, subCtx, subScope);
  };
  const aggTargetFields = rel ? relScope.fields.filter((f) => f.aggregatable) : [];
  const aggTargetField = rel ? relScope.fields.find((f) => f.name === agg.field) : void 0;
  const aggregateValidation = isAggregate ? validateAggregate(rec, field, aggTargetField) : void 0;
  const conditionNode = rel && (isAggregate || cat === "predicate" || cat === "count") ? buildSub("condition") : void 0;
  const filterNode = rel && !isAggregate ? buildSub("filter") : void 0;
  const selectorFacet = matchedFacet?.selectors?.length && rel && !isAggregate && conditionNode !== void 0 && selectorsApply(scope.lens, matchedFacet) ? matchedFacet : void 0;
  return {
    kind: "array",
    id: idOf(node, path.length ? path[path.length - 1] : 0),
    path,
    depth,
    relation: rel,
    field: {
      value: fieldName,
      options: selectableFields(scope.fields).map((f) => ({
        value: f.name,
        label: f.label,
        icon: f.icon
      })),
      set: (name) => {
        const next = scope.fields.find((f) => f.name === name);
        if (!next) return;
        const id = rec.__id ? { __id: rec.__id } : {};
        if (isAggregate && next.isList && next.relation) {
          ctx.commit(
            setNode(ctx.root, path, {
              field: name,
              aggregate: { mode: aggMode },
              operator: rec.operator ?? "greaterThan",
              ...rec.value !== void 0 ? { value: rec.value } : {},
              ...id
            })
          );
          return;
        }
        ctx.commit(setNode(ctx.root, path, ruleForField(next, rec.__id)));
      },
      valid: field !== void 0
    },
    hoist: matchedFacet ? {
      id: facetId(matchedFacet),
      label: matchedFacet.label ?? fieldName ?? "",
      icon: matchedFacet.icon
    } : void 0,
    selectors: selectorFacet?.selectors,
    selectorClauses: selectorFacet ? selectorClauseNodes : void 0,
    setSelectorClause: selectorFacet ? (selectorField, value) => {
      if (!selectorFacet.selectors?.some((s) => s.field === selectorField)) return;
      const next = writeSelectorClause(
        selectorFacet,
        rec.condition,
        selectorField,
        value
      );
      ctx.commit(setNode(ctx.root, path, { ...rec, condition: next }));
    } : void 0,
    facetMode: facetModeControl(matchedFacet, rec, path, ctx),
    atomic: matchedFacet && isPreset(matchedFacet) ? true : void 0,
    // Element-mode operator: absent on an aggregate node (it carries `aggregate`).
    arrayOperator: isAggregate ? void 0 : {
      value: op,
      options: (field?.operators.array ?? []).map((o) => ({
        value: o,
        label: o
      })),
      hidden: matchedFacet ? true : void 0,
      set: (nextOp) => {
        const nextCat = arrayCat(nextOp);
        const { count, condition, ...restRec } = rec;
        const out = { ...restRec, arrayOperator: nextOp };
        if (nextCat !== "presence" && condition !== void 0) out.condition = condition;
        if (nextCat === "count" && count !== void 0) out.count = count;
        ctx.commit(setNode(ctx.root, path, out));
      }
    },
    // Aggregate mode: sum/avg over the related list → a threshold comparison. The
    // element window is authored via `condition` (below), not a separate control.
    aggregate: isAggregate ? {
      mode: aggMode,
      modeOptions: AGGREGATE_MODES.map((m) => ({ value: m, label: m })),
      setMode: (m) => ctx.commit(
        setNode(ctx.root, path, { ...rec, aggregate: { ...agg, mode: m } })
      ),
      field: {
        value: agg.field,
        options: aggTargetFields.map((f) => ({
          value: f.name,
          label: f.label,
          icon: f.icon,
          compilesToPrisma: f.compilesToPrisma
        })),
        set: (name) => ctx.commit(
          setNode(ctx.root, path, {
            ...rec,
            aggregate: { ...agg, field: name }
          })
        ),
        valid: aggTargetField?.aggregatable === true,
        compilesToPrisma: aggTargetField?.compilesToPrisma
      },
      operator: {
        value: rec.operator,
        options: AGGREGATE_OPERATORS.map((o) => ({ value: o, label: o })),
        set: (nextOp) => ctx.commit(setNode(ctx.root, path, { ...rec, operator: nextOp }))
      },
      value: {
        current: rec.value,
        shape: rec.operator ? valueShapeForOperator(rec.operator) : "none",
        set: (v) => ctx.commit(setNode(ctx.root, path, { ...rec, value: v }))
      }
    } : void 0,
    count: !isAggregate && cat === "count" ? {
      value: rec.count,
      set: (n) => ctx.commit(setNode(ctx.root, path, { ...rec, count: n }))
    } : void 0,
    // Element predicate (element mode) OR aggregate window (aggregate mode) — both
    // ride the same `condition` sub-builder scoped to the related model.
    condition: conditionNode,
    // `filter` is authored windowing — offered on element rules, never on an
    // aggregate (toPrisma() rejects windowing on aggregates).
    filter: filterNode,
    removeFilter: rel && !isAggregate ? () => {
      const { filter: _f, ...restRec } = rec;
      ctx.commit(setNode(ctx.root, path, restRec));
    } : void 0,
    valid: checkRuleAgainstLens2(node, scope.lens).ok && (aggregateValidation?.ok ?? true),
    // A root array rule has no parent to splice out of — deleting it clears to a
    // blank group, mirroring the leaf-root behavior.
    remove: () => ctx.commit(path.length ? removeNode(ctx.root, path) : { all: [] })
  };
};
var buildGroup = (node, path, depth, ctx, scope) => {
  const matched = scope.decoration ? matchFacet(scope.lens, scope.decoration, node) : void 0;
  const preset = matched !== void 0 && isPreset(matched);
  const branchFacet = matched && !preset && path.length > 0 ? matched : void 0;
  const branch = branchFacet && facetBranchScope(ctx.anchorLens, branchFacet, ctx.surfaceOpts);
  const groupScope = branch ? { lens: scope.lens, fields: relabelRelations(branch.fields, ctx.decoration) } : scope;
  const groupFacet = preset ? matched : branchFacet;
  const groupHoist = groupFacet ? {
    id: facetId(groupFacet),
    label: groupFacet.label ?? branch?.prefix ?? "",
    icon: groupFacet.icon
  } : void 0;
  const groupLabel = groupHoist?.label ?? (path.length === 0 ? modelDecor(ctx.decoration, scope.lens.mapName, scope.lens.model).label : void 0);
  const identityLead = branchFacet && branch ? leadingIdentityCount(scope.lens, branchFacet, node) : 0;
  const kids = groupChildrenOf(node);
  const rowsTail = kids[identityLead];
  const selectorGroupFacet = branchFacet?.selectors?.length && branch && selectorsApply(scope.lens, branchFacet) ? branchFacet : void 0;
  const setGroupSelectorClause = selectorGroupFacet ? (selectorField, value) => {
    if (!selectorGroupFacet.selectors?.some((s) => s.field === selectorField)) return;
    ctx.commit(
      setNode(
        ctx.root,
        path,
        writeSelectorClause(selectorGroupFacet, node, selectorField, value)
      )
    );
  } : void 0;
  if (identityLead > 0 && kids.length === identityLead + 1 && rowsTail && isGroupNode(rowsTail)) {
    const whereLead = branchFacet ? leadingWhereCount(branchFacet, node) : 0;
    const inner = buildGroup(rowsTail, [...path, identityLead], depth, ctx, groupScope);
    return {
      ...inner,
      label: groupLabel ?? inner.label,
      hoist: groupHoist,
      selectors: selectorGroupFacet?.selectors,
      selectorClauses: selectorGroupFacet && identityLead > whereLead ? kids.slice(whereLead, identityLead).map((clause, i) => {
        const built = buildNode(clause, [...path, whereLead + i], depth, ctx, groupScope);
        const clauseField = clause.field ?? groupChildrenOf(clause)[0]?.field;
        return clauseField ? { ...built, remove: () => setGroupSelectorClause?.(clauseField, null) } : built;
      }) : void 0,
      setSelectorClause: setGroupSelectorClause,
      atomic: void 0,
      facetMode: facetModeControl(groupFacet, node, path, ctx),
      remove: path.length ? () => ctx.commit(removeNode(ctx.root, path)) : void 0
    };
  }
  return {
    kind: "group",
    id: idOf(node, path.length ? path[path.length - 1] : 0),
    path,
    depth,
    label: groupLabel,
    operator: {
      value: groupOperatorOf(node),
      set: (op) => ctx.commit(setNode(ctx.root, path, switchGroupOperator(node, op)))
    },
    children: groupChildrenOf(node).map(
      (child, i) => buildNode(child, [...path, i], depth + 1, ctx, groupScope)
    ),
    addRule: () => ctx.commit(addRule(ctx.root, path, defaultRule(groupScope.fields))),
    addGroup: () => ctx.commit(addRule(ctx.root, path, { all: [] })),
    canAddGroup: depth < ctx.maxDepth,
    hoist: groupHoist,
    atomic: preset ? true : void 0,
    facetMode: facetModeControl(groupFacet, node, path, ctx),
    selectors: selectorGroupFacet?.selectors,
    setSelectorClause: setGroupSelectorClause,
    remove: path.length ? () => ctx.commit(removeNode(ctx.root, path)) : void 0
  };
};
var facetModeControl = (matched, rec, path, ctx) => {
  const detached = rec.__facetId === null;
  if (!matched && !detached) return void 0;
  return {
    value: detached ? "raw" : "faceted",
    set: (mode) => {
      if (mode === "raw" === detached) return;
      const { __facetId: _f, ...restRec } = rec;
      ctx.commit(
        setNode(
          ctx.root,
          path,
          mode === "raw" ? { ...rec, __facetId: null } : restRec
        )
      );
    }
  };
};
var buildNode = (node, path, depth, ctx, scope) => isGroupNode(node) ? buildGroup(node, path, depth, ctx, scope) : isArrayNode(node) || isAggregateNode(node) ? buildArray(node, path, depth, ctx, scope) : buildLeaf(node, path, depth, ctx, scope);
var asGroupRoot = (cond) => cond !== void 0 && isGroupNode(cond) ? cond : { all: cond !== void 0 ? [cond] : [] };
var asRoot = (cond, empty = { all: [] }) => cond === void 0 ? empty : cond;
var buildRoot = (root, lens, fields, maxDepth, commit, opts = {}) => {
  const normalized = asRoot(root);
  const ctx = {
    root: normalized,
    maxDepth,
    commit,
    anchorLens: lens,
    decoration: opts.decoration,
    surfaceOpts: opts.surfaceOpts ?? {}
  };
  return buildNode(normalized, [], 0, ctx, { lens, fields, decoration: opts.decoration });
};

// src/builder/useFilteredCollection.ts
import {
  check,
  engineGlobals,
  sourceValuesFromRows
} from "@inixiative/json-rules";
import { useMemo as useMemo3 } from "react";

// src/builder/useRuleBuilder.ts
import {
  describeRule,
  stampCoercions,
  validateRule
} from "@inixiative/json-rules";
import { useCallback, useEffect as useEffect2, useMemo as useMemo2, useRef, useState } from "react";
var EMPTY = { all: [] };
var useRuleBuilder = (opts) => {
  const lens = useMemo2(
    () => resolve(opts.source, { sourceValues: opts.sourceValues }),
    [opts.source, opts.sourceValues]
  );
  const surfaceOpts = useMemo2(() => {
    const fromDecoration = decorationSurfaceOptions(opts.decoration);
    return {
      targets: opts.targets,
      labels: { ...fromDecoration.labels, ...opts.labels },
      valueLabels: { ...fromDecoration.valueLabels, ...opts.valueLabels }
    };
  }, [opts.decoration, opts.targets, opts.labels, opts.valueLabels]);
  const anchorFields = useMemo2(() => {
    const all = relabelRelations(
      describeModelFields(lens, lens.mapName, lens.model, surfaceOpts),
      opts.decoration
    );
    const consumed = consumedTopFields(opts.decoration);
    return consumed.size ? all.filter((f) => !consumed.has(f.name)) : all;
  }, [lens, surfaceOpts, opts.decoration]);
  const hoisted = useFacetFields(lens, opts.decoration, surfaceOpts);
  const fields = useMemo2(
    () => hoisted.length ? [...hoisted, ...anchorFields] : anchorFields,
    [anchorFields, hoisted]
  );
  const maxDepth = opts.maxDepth ?? 4;
  const ingest = (c) => {
    const rooted = asRoot(c, opts.empty);
    return withIds(opts.decoration ? stampFacetIds(rooted, lens, opts.decoration) : rooted);
  };
  const [tree, setTree] = useState(() => ingest(opts.defaultValue));
  const onChangeRef = useRef(opts.onChange);
  onChangeRef.current = opts.onChange;
  const first = useRef(true);
  const clean = useCallback(
    (t) => stampCoercions(stripMeta(trimEmptyGroups(t) ?? EMPTY), lens),
    [lens]
  );
  useEffect2(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current?.(clean(tree));
  }, [tree, clean]);
  const commit = useCallback((next) => setTree(withIds(next)), []);
  const root = useMemo2(
    () => buildRoot(tree, lens, fields, maxDepth, commit, { decoration: opts.decoration, surfaceOpts }),
    [tree, lens, fields, maxDepth, commit, opts.decoration, surfaceOpts]
  );
  const value = useMemo2(() => clean(tree), [tree, clean]);
  return {
    value,
    root,
    lens,
    setCondition: (c) => setTree(ingest(c)),
    validate: (target) => validateRule(value, { target }),
    describe: () => describeRule(value, lens)
  };
};

// src/builder/useFilteredCollection.ts
var DEFAULT_STRING_MATCH = {
  caseInsensitive: true,
  fuzzy: { maxRatio: 0.2, maxDistance: 1 }
};
var useFilteredCollection = (opts) => {
  const { rows, checkOptions, caseInsensitive, fuzzy, ...builderOpts } = opts;
  const sourceValues = useMemo3(
    () => sourceValuesFromRows(composeNarrowed(opts.source), rows, checkOptions),
    [opts.source, rows, checkOptions]
  );
  const builder = useRuleBuilder({ ...builderOpts, sourceValues });
  const stringMatch = useMemo3(
    () => ({
      caseInsensitive: caseInsensitive ?? DEFAULT_STRING_MATCH.caseInsensitive,
      fuzzy: fuzzy ?? DEFAULT_STRING_MATCH.fuzzy
    }),
    [caseInsensitive, fuzzy]
  );
  const data = useMemo3(
    () => engineGlobals.with(
      { string: stringMatch },
      () => rows.filter((row) => check(builder.value, row, checkOptions) === true)
    ),
    [rows, builder.value, checkOptions, stringMatch]
  );
  return { ...builder, data };
};

// src/permissions/actionTree.ts
var isObj3 = (r) => typeof r === "object" && r !== null;
var actionKind = (rule) => {
  if (rule === null || rule === false) return "deny";
  if (rule === true) return "allow";
  if (typeof rule === "string") return "delegate";
  if ("any" in rule) return "any";
  if ("all" in rule) return "all";
  if ("rel" in rule) return "rel";
  if ("self" in rule) return "self";
  return "rule";
};
var isActionGroup = (rule) => {
  const k = actionKind(rule);
  return k === "any" || k === "all";
};
var childrenOfAction = (rule) => {
  if (!isObj3(rule)) return [];
  if ("any" in rule) return rule.any;
  if ("all" in rule) return rule.all;
  return [];
};
var withChildren = (rule, next) => {
  if (isObj3(rule) && "any" in rule) return { any: next };
  if (isObj3(rule) && "all" in rule) return { all: next };
  throw new Error("withChildren: not an any/all group");
};
var defaultActionRule = () => ({ rule: { all: [] } });
var getActionNode = (rule, path) => {
  let cur = rule;
  for (const i of path) {
    if (cur === void 0) return void 0;
    cur = childrenOfAction(cur)[i];
  }
  return cur;
};
var setActionNode = (rule, path, next) => {
  if (path.length === 0) return next;
  const [i, ...rest] = path;
  const kids = childrenOfAction(rule).slice();
  kids[i] = setActionNode(kids[i], rest, next);
  return withChildren(rule, kids);
};
var addActionChild = (rule, path) => {
  const group = getActionNode(rule, path);
  if (group === void 0 || !isActionGroup(group))
    throw new Error("addActionChild: target is not a group");
  return setActionNode(
    rule,
    path,
    withChildren(group, [...childrenOfAction(group), defaultActionRule()])
  );
};
var removeActionNode = (rule, path) => {
  if (path.length === 0) throw new Error("removeActionNode: cannot remove the root");
  const parentPath = path.slice(0, -1);
  const i = path[path.length - 1];
  const parent = getActionNode(rule, parentPath);
  if (parent === void 0 || !isActionGroup(parent))
    throw new Error("removeActionNode: parent is not a group");
  return setActionNode(
    rule,
    parentPath,
    withChildren(
      parent,
      childrenOfAction(parent).filter((_, n) => n !== i)
    )
  );
};

// src/permissions/buildActionRoot.ts
var KIND_OPTIONS = [
  { value: "rule", label: "rule (abac)" },
  { value: "self", label: "self (owner)" },
  { value: "rel", label: "rel (walk)" },
  { value: "delegate", label: "delegate" },
  { value: "any", label: "any (OR)" },
  { value: "all", label: "all (AND)" },
  { value: "allow", label: "allow (true)" },
  { value: "deny", label: "deny (false)" }
];
var defaultForKind = (kind) => {
  switch (kind) {
    case "delegate":
      return "";
    case "rel":
      return { rel: "", action: "" };
    case "self":
      return { self: "" };
    case "rule":
      return { rule: { all: [] } };
    case "any":
      return { any: [] };
    case "all":
      return { all: [] };
    case "allow":
      return true;
    case "deny":
      return false;
  }
};
var opt = (v) => ({ value: v, label: v });
var build = (node, path, depth, ctx) => {
  const kind = actionKind(node);
  const base = {
    id: path.length ? path.join(".") : "root",
    path,
    depth,
    kind: {
      value: kind,
      options: KIND_OPTIONS,
      set: (k) => ctx.commit(setActionNode(ctx.root, path, defaultForKind(k)))
    },
    remove: path.length ? () => ctx.commit(removeActionNode(ctx.root, path)) : void 0
  };
  if (kind === "any" || kind === "all") {
    return {
      ...base,
      children: childrenOfAction(node).map((c, i) => build(c, [...path, i], depth + 1, ctx)),
      addChild: depth < ctx.maxDepth ? () => ctx.commit(addActionChild(ctx.root, path)) : void 0
    };
  }
  if (kind === "delegate") {
    return {
      ...base,
      delegate: {
        value: node,
        options: ctx.siblingActions.map(opt),
        set: (a) => ctx.commit(setActionNode(ctx.root, path, a))
      }
    };
  }
  if (kind === "self") {
    return {
      ...base,
      self: {
        value: node.self,
        options: ctx.fields.filter((f) => !f.relation).map((f) => opt(f.name)),
        set: (f) => ctx.commit(setActionNode(ctx.root, path, { self: f }))
      }
    };
  }
  if (kind === "rel") {
    const rel = node;
    const currentResource = `${ctx.lens.mapName}:${ctx.lens.model}`;
    const fieldsAt = (resource2) => resource2 === currentResource ? ctx.fields : ctx.resourceFields?.(resource2) ?? [];
    const relTargetOf = (f) => f?.relation ? `${f.relation.mapName}:${f.relation.modelName}` : void 0;
    const relOptionsAt = (resource2) => fieldsAt(resource2).filter((f) => f.relation && !f.isList).map((f) => opt(f.name));
    const setRel = (next) => ctx.commit(setActionNode(ctx.root, path, { rel: next, action: "" }));
    const segs = rel.rel ? rel.rel.split(".") : [];
    let resource = currentResource;
    let resolved = true;
    const segments = segs.map((seg, i) => {
      const optionsResource = resource;
      const next = relTargetOf(fieldsAt(resource).find((x) => x.name === seg));
      if (next) resource = next;
      else resolved = false;
      return {
        value: seg,
        options: relOptionsAt(optionsResource),
        set: (r) => setRel([...segs.slice(0, i), r].join("."))
      };
    });
    const target = resolved ? resource : void 0;
    return {
      ...base,
      rel: {
        segments,
        addOptions: target ? relOptionsAt(target) : [],
        addSegment: (r) => setRel([...segs, r].join(".")),
        removeLast: segs.length ? () => setRel(segs.slice(0, -1).join(".")) : void 0,
        action: {
          value: rel.action,
          options: (target && ctx.actionsByResource[target] || []).map(opt),
          set: (a) => ctx.commit(setActionNode(ctx.root, path, { rel: rel.rel, action: a }))
        },
        target
      }
    };
  }
  if (kind === "allow" || kind === "deny") return base;
  const cond = node.rule;
  return {
    ...base,
    rule: buildRoot(
      cond,
      ctx.lens,
      ctx.fields,
      ctx.maxDepth,
      (next) => ctx.commit(setActionNode(ctx.root, path, { rule: next }))
    )
  };
};
var buildActionRoot = (rule, opts) => build(rule, [], 0, { ...opts, root: rule, maxDepth: opts.maxDepth ?? 4 });

// src/permissions/schema.ts
var actionNamesByResource = (schema) => Object.fromEntries(
  Object.entries(schema.permissions).map(([resource, mp]) => [
    resource,
    Object.keys(mp?.actions ?? {})
  ])
);
var setSchemaAction = (schema, resource, action, rule) => ({
  ...schema,
  permissions: {
    ...schema.permissions,
    [resource]: { actions: { ...schema.permissions[resource]?.actions ?? {}, [action]: rule } }
  }
});
var removeSchemaAction = (schema, resource, action) => {
  const entry = schema.permissions[resource];
  if (!entry) return schema;
  const { [action]: _drop, ...actions } = entry.actions;
  const permissions = { ...schema.permissions };
  if (Object.keys(actions).length === 0) delete permissions[resource];
  else permissions[resource] = { actions };
  return { ...schema, permissions };
};

// src/permissions/useActionRuleBuilder.ts
import { useCallback as useCallback2, useEffect as useEffect3, useMemo as useMemo4, useRef as useRef2, useState as useState2 } from "react";
var useActionRuleBuilder = (opts) => {
  const lens = useMemo4(
    () => resolve(opts.source, { sourceValues: opts.sourceValues }),
    [opts.source, opts.sourceValues]
  );
  const fields = useMemo4(() => describeModelFields(lens, lens.mapName, lens.model), [lens]);
  const [tree, setTree] = useState2(() => opts.defaultValue ?? defaultActionRule());
  const onChangeRef = useRef2(opts.onChange);
  onChangeRef.current = opts.onChange;
  const first = useRef2(true);
  useEffect3(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current?.(tree);
  }, [tree]);
  const commit = useCallback2((next) => setTree(next), []);
  const maps = opts.source.maps;
  const bridges = opts.source.bridges;
  const resourceFields = useCallback2(
    (res) => {
      const i = res.indexOf(":");
      const mapName = i === -1 ? "" : res.slice(0, i);
      const model = i === -1 ? res : res.slice(i + 1);
      if (!maps[mapName]?.models[model]) return [];
      return describeModelFields(resolve({ maps, bridges, mapName, model }), mapName, model);
    },
    [maps, bridges]
  );
  const root = useMemo4(
    () => buildActionRoot(tree, {
      lens,
      fields,
      siblingActions: opts.siblingActions ?? [],
      actionsByResource: opts.actionsByResource ?? {},
      resourceFields,
      maxDepth: opts.maxDepth,
      commit
    }),
    [
      tree,
      lens,
      fields,
      opts.siblingActions,
      opts.actionsByResource,
      opts.maxDepth,
      commit,
      resourceFields
    ]
  );
  return { value: tree, root, setRule: setTree };
};

// src/permissions/usePermissionBuilder.ts
var splitResource = (resource) => {
  const i = resource.indexOf(":");
  return i === -1 ? ["", resource] : [resource.slice(0, i), resource.slice(i + 1)];
};
var usePermissionBuilder = (opts) => {
  const { maps, bridges, maxDepth } = opts;
  const schema = opts.value;
  const setSchema = opts.onChange;
  const actionsByResource = actionNamesByResource(schema);
  const actionsOf = (resource) => Object.keys(schema.permissions[resource]?.actions ?? {});
  const setAction = (resource, action, rule) => setSchema(setSchemaAction(schema, resource, action, rule));
  const addAction = (resource, action) => {
    if (!action || schema.permissions[resource]?.actions[action] !== void 0) return;
    setAction(resource, action, defaultActionRule());
  };
  const removeAction = (resource, action) => setSchema(removeSchemaAction(schema, resource, action));
  const addResource = (resource) => {
    if (schema.permissions[resource] !== void 0) return;
    setSchema({ ...schema, permissions: { ...schema.permissions, [resource]: { actions: {} } } });
  };
  const removeResource = (resource) => {
    const { [resource]: _drop, ...rest } = schema.permissions;
    setSchema({ ...schema, permissions: rest });
  };
  const resourceFields = (res) => {
    const [m, mdl] = splitResource(res);
    if (!maps[m]?.models[mdl]) return [];
    return describeModelFields(resolve({ maps, bridges, mapName: m, model: mdl }), m, mdl);
  };
  const actionRoot = (resource, action) => {
    const rule = schema.permissions[resource]?.actions[action];
    if (rule === void 0) return null;
    const [mapName, model] = splitResource(resource);
    if (!maps[mapName]?.models[model]) return null;
    const lens = resolve({ maps, bridges, mapName, model });
    const fields = describeModelFields(lens, mapName, model);
    return buildActionRoot(rule, {
      lens,
      fields,
      siblingActions: actionsOf(resource).filter((a) => a !== action),
      actionsByResource,
      resourceFields,
      maxDepth,
      commit: (next) => setAction(resource, action, next)
    });
  };
  return {
    value: schema,
    setSchema,
    resources: Object.keys(schema.permissions),
    actionsByResource,
    actionsOf,
    addResource,
    removeResource,
    addAction,
    removeAction,
    setAction,
    actionRoot
  };
};

// src/schema/lensValuePicker.ts
import {
  exposedSurface as exposedSurface4
} from "@inixiative/json-rules";
import { useMemo as useMemo5 } from "react";
var RELATION_KINDS3 = /* @__PURE__ */ new Set(["object", "bridge"]);
var lensValuePicker = (lensOrNarrowing, opts = {}) => {
  const lens = exposedSurface4(lensOrNarrowing);
  const startMap = opts.mapName ?? lens.mapName;
  const startModel = opts.model ?? lens.model;
  const maxDepth = opts.maxDepth ?? 0;
  const out = [];
  const walk = (mapName, modelName, prefix, depth, seen) => {
    const model = lens.maps[mapName]?.models[modelName];
    if (!model) return;
    const key = `${mapName}:${modelName}`;
    if (seen.has(key)) return;
    const nextSeen = /* @__PURE__ */ new Set([...seen, key]);
    for (const [name, entry] of Object.entries(model.fields)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (RELATION_KINDS3.has(entry.kind)) {
        if (depth >= maxDepth) continue;
        const target = relationTarget(entry, mapName);
        if (target) walk(target.mapName, target.modelName, path, depth + 1, nextSeen);
        continue;
      }
      const isEnum = entry.kind === "enum";
      const kind = isEnum ? "Enum" : toFieldKind(entry.type);
      out.push({
        path,
        field: name,
        kind,
        label: opts.labels?.[path] ?? name,
        isList: entry.isList === true,
        values: isEnum ? entry.values ?? lens.maps[mapName]?.enums?.[entry.type] : entry.values,
        acceptsSubPath: kind === "Json"
      });
    }
  };
  walk(startMap, startModel, "", 0, /* @__PURE__ */ new Set());
  return out;
};
var useLensValuePicker = (lensOrNarrowing, opts = {}) => (
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on option fields, not opts identity, so inline literals don't re-run the walk
  useMemo5(
    () => lensValuePicker(lensOrNarrowing, opts),
    [lensOrNarrowing, opts.mapName, opts.model, opts.maxDepth, opts.labels]
  )
);

// src/schema/sources.ts
import {
  check as check2,
  sourceQueries
} from "@inixiative/json-rules";
var runSources = (lensOrNarrowing, rows) => sourceQueries(lensOrNarrowing).map((q) => {
  const matched = (rows[q.model] ?? []).filter((r) => check2(q.composedWhere, r) === true);
  const seen = /* @__PURE__ */ new Set();
  const options = [];
  for (const r of matched) {
    const raw = r[q.field];
    if (raw == null) continue;
    const value = String(raw);
    if (seen.has(value)) continue;
    seen.add(value);
    const labelRaw = q.label ? r[q.label] : void 0;
    options.push(labelRaw == null ? { value } : { value, label: String(labelRaw) });
  }
  return {
    path: q.path,
    mapName: q.mapName,
    model: q.model,
    field: q.field,
    options
  };
});

// src/serialize.ts
var stringifySavedRule = (saved, space = 2) => JSON.stringify(saved, null, space);
var parseSavedRule = (json) => {
  const data = JSON.parse(json);
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("SavedRule must be a JSON object");
  }
  const rec = data;
  if (!("rule" in rec)) throw new Error("SavedRule.rule is required");
  if (!("source" in rec) || rec.source == null) throw new Error("SavedRule.source is required");
  if ("sourceValues" in rec && rec.sourceValues !== void 0 && !Array.isArray(rec.sourceValues)) {
    throw new Error("SavedRule.sourceValues must be an array when present");
  }
  return rec;
};

// src/transitions/transitionTree.ts
var emptyTransition = () => ({
  from: { predicate: { all: [] } },
  to: { predicate: { all: [] } }
});
var emptyAction = () => ({ paths: [emptyTransition()] });
var setTransitionAction = (schema, resource, action, value) => ({
  ...schema,
  [resource]: { ...schema[resource] ?? {}, [action]: value }
});
var removeTransitionAction = (schema, resource, action) => {
  const actions = schema[resource];
  if (!actions) return schema;
  const { [action]: _drop, ...rest } = actions;
  const next = { ...schema };
  if (Object.keys(rest).length === 0) delete next[resource];
  else next[resource] = rest;
  return next;
};
var mapAction = (schema, resource, action, fn) => {
  const a = schema[resource]?.[action];
  if (!a) return schema;
  return setTransitionAction(schema, resource, action, fn(a));
};
var addPath = (schema, resource, action) => mapAction(schema, resource, action, (a) => ({ ...a, paths: [...a.paths, emptyTransition()] }));
var removePath = (schema, resource, action, i) => mapAction(schema, resource, action, (a) => ({ ...a, paths: a.paths.filter((_, n) => n !== i) }));
var updateSide = (schema, resource, action, i, side, fn) => mapAction(schema, resource, action, (a) => ({
  ...a,
  paths: a.paths.map((p, n) => n === i ? { ...p, [side]: fn(p[side]) } : p)
}));

// src/transitions/useTransitionBuilder.ts
var splitResource2 = (r) => {
  const i = r.indexOf(":");
  return i === -1 ? ["", r] : [r.slice(0, i), r.slice(i + 1)];
};
var useTransitionBuilder = (opts) => {
  const { maps, bridges, maxDepth } = opts;
  const schema = opts.value;
  const setSchema = opts.onChange;
  const permissionActions = opts.permissionActions ?? {};
  const actionsOf = (resource) => Object.keys(schema[resource] ?? {});
  const sideOf = (resource, action, i, side) => schema[resource]?.[action]?.paths[i]?.[side];
  const surface = (resource) => {
    const [mapName, model] = splitResource2(resource);
    if (!maps[mapName]?.models[model]) return null;
    const lens = resolve({ maps, bridges, mapName, model });
    return { lens, fields: describeModelFields(lens, mapName, model), mapName, model };
  };
  const resourceFields = (res) => {
    const s = surface(res);
    return s ? s.fields : [];
  };
  const addResource = (resource) => {
    if (schema[resource] !== void 0) return;
    setSchema({ ...schema, [resource]: {} });
  };
  const removeResource = (resource) => {
    const { [resource]: _drop, ...rest } = schema;
    setSchema(rest);
  };
  const addAction = (resource, action) => {
    if (!action || schema[resource]?.[action] !== void 0) return;
    setSchema(setTransitionAction(schema, resource, action, emptyAction()));
  };
  const removeAction = (resource, action) => setSchema(removeTransitionAction(schema, resource, action));
  const predicateRoot = (resource, action, i, side) => {
    const sideObj = sideOf(resource, action, i, side);
    const s = surface(resource);
    if (!sideObj || !s) return null;
    return buildRoot(
      sideObj.predicate,
      s.lens,
      s.fields,
      maxDepth ?? 4,
      (next) => setSchema(
        updateSide(schema, resource, action, i, side, (sd) => ({ ...sd, predicate: next }))
      )
    );
  };
  const permissionRoot = (resource, action, i, side) => {
    const sideObj = sideOf(resource, action, i, side);
    const s = surface(resource);
    if (!sideObj || sideObj.permission === void 0 || !s) return null;
    return buildActionRoot(sideObj.permission, {
      lens: s.lens,
      fields: s.fields,
      siblingActions: permissionActions[resource] ?? [],
      actionsByResource: permissionActions,
      resourceFields,
      maxDepth,
      commit: (next) => setSchema(
        updateSide(schema, resource, action, i, side, (sd) => ({ ...sd, permission: next }))
      )
    });
  };
  return {
    value: schema,
    setSchema,
    resources: Object.keys(schema),
    actionsOf,
    addResource,
    removeResource,
    addAction,
    removeAction,
    pathCount: (resource, action) => schema[resource]?.[action]?.paths.length ?? 0,
    addPath: (resource, action) => setSchema(addPath(schema, resource, action)),
    removePath: (resource, action, i) => setSchema(removePath(schema, resource, action, i)),
    predicateRoot,
    permissionHas: (resource, action, i, side) => sideOf(resource, action, i, side)?.permission !== void 0,
    enablePermission: (resource, action, i, side) => setSchema(
      updateSide(schema, resource, action, i, side, (sd) => ({
        ...sd,
        permission: defaultActionRule()
      }))
    ),
    clearPermission: (resource, action, i, side) => setSchema(
      updateSide(schema, resource, action, i, side, (sd) => {
        const { permission: _drop, ...rest } = sd;
        return rest;
      })
    ),
    permissionRoot,
    mergeOf: (resource, action, i) => schema[resource]?.[action]?.paths[i]?.to.merge,
    setMerge: (resource, action, i, merge) => setSchema(
      updateSide(schema, resource, action, i, "to", (sd) => {
        if (merge === void 0) {
          const { merge: _drop, ...rest } = sd;
          return rest;
        }
        return { ...sd, merge };
      })
    )
  };
};
export {
  actionKind,
  actionNamesByResource,
  addActionChild,
  addRule,
  asGroupRoot,
  asRoot,
  branchFields,
  buildActionRoot,
  buildRoot,
  childrenOfAction,
  consumedTopFields,
  decorationSurfaceOptions,
  defaultActionRule,
  describeFacets,
  describeModelFields,
  emptyAction,
  facetBranchScope,
  facetElementLeaf,
  facetId,
  getActionNode,
  getNode,
  groupSiblings,
  isActionGroup,
  isPreset,
  leadingIdentityCount,
  leadingWhereCount,
  lensValuePicker,
  matchFacet,
  modelDecor,
  modelFacets,
  parseSavedRule,
  relabelRelations,
  removeActionNode,
  removeNode,
  removeSchemaAction,
  resolve,
  runSources,
  scopedDecoration,
  scopedFacetId,
  selectorsApply,
  setActionNode,
  setNode,
  setSchemaAction,
  stampFacetIds,
  stringifySavedRule,
  stripMeta,
  switchGroupOperator,
  trimEmptyGroups,
  unwrapCompound,
  useActionRuleBuilder,
  useFacetFields,
  useFilteredCollection,
  useLensValuePicker,
  usePermissionBuilder,
  useRuleBuilder,
  useTransitionBuilder,
  validateDecoration,
  valueShapeForOperator,
  whereConditions,
  withIds,
  wrapInCompound,
  writeSelectorClause
};
//# sourceMappingURL=index.js.map