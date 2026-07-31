"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/schema/index.ts
var schema_exports = {};
__export(schema_exports, {
  branchFields: () => branchFields,
  consumedTopFields: () => consumedTopFields,
  decorationSurfaceOptions: () => decorationSurfaceOptions,
  describeFacets: () => describeFacets,
  describeModelFields: () => describeModelFields,
  facetBranchScope: () => facetBranchScope,
  facetElementLeaf: () => facetElementLeaf,
  facetId: () => facetId,
  isPreset: () => isPreset,
  leadingIdentityCount: () => leadingIdentityCount,
  leadingWhereCount: () => leadingWhereCount,
  lensValuePicker: () => lensValuePicker,
  matchFacet: () => matchFacet,
  modelDecor: () => modelDecor,
  modelFacets: () => modelFacets,
  relabelRelations: () => relabelRelations,
  resolve: () => resolve,
  runSources: () => runSources,
  scopedDecoration: () => scopedDecoration,
  scopedFacetId: () => scopedFacetId,
  selectorsApply: () => selectorsApply,
  stampFacetIds: () => stampFacetIds,
  useFacetFields: () => useFacetFields,
  useLensValuePicker: () => useLensValuePicker,
  validateDecoration: () => validateDecoration,
  valueShapeForOperator: () => valueShapeForOperator,
  whereConditions: () => whereConditions,
  writeSelectorClause: () => writeSelectorClause
});
module.exports = __toCommonJS(schema_exports);

// src/schema/decoration.ts
var import_json_rules2 = require("@inixiative/json-rules");
var import_react = require("react");

// src/builder/nodes.ts
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

// src/schema/surface.ts
var import_json_rules = require("@inixiative/json-rules");
var composeNarrowed = (source) => {
  const lens = (0, import_json_rules.createLens)({
    maps: source.maps,
    bridges: source.bridges,
    mapName: source.mapName,
    model: source.model
  });
  return source.narrowing ? { parent: lens, ...source.narrowing } : lens;
};
var resolve = (source, opts = {}) => (0, import_json_rules.exposedSurface)(composeNarrowed(source), { sourceValues: opts.sourceValues });
var RELATION_KINDS = /* @__PURE__ */ new Set(["object", "bridge"]);
var KNOWN_KINDS = new Set(import_json_rules.ALL_KINDS);
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
  const base = (0, import_json_rules.getOperatorsForKind)(kind);
  const field = base.field.filter(
    (op) => supportedByAllTargets(op, targets, (t) => (0, import_json_rules.getOperatorsForKind)(kind, t).field)
  );
  const date = base.date.filter(
    (op) => supportedByAllTargets(op, targets, (t) => (0, import_json_rules.getOperatorsForKind)(kind, t).date)
  );
  return { field, date };
};
var arrayOperators = (targets) => (0, import_json_rules.getArrayOperators)().filter(
  (op) => supportedByAllTargets(op, targets, (t) => (0, import_json_rules.getArrayOperators)(t))
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
    const isNumericScalar = entry.kind === "scalar" && import_json_rules.NUMERIC_KINDS.includes(kind);
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
var valueShapeForOperator = (operator) => (0, import_json_rules.getValueShape)(operator);

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
  const kids = groupChildren(cond);
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
var groupChildren = (node) => {
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
  const children = groupChildren(node);
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
      const tailRows = tail && typeof tail === "object" ? groupChildren(tail) ?? [] : [];
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
      const relLens = (0, import_json_rules2.exposedSurface)(
        (0, import_json_rules2.createLens)({ maps: lens.maps, mapName: rel.mapName, model: rel.modelName })
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
        (c, i) => selectorClauseField(facet, c) === field && !(i === rest.length - 1 && groupChildren(c) !== void 0)
      );
      if (at >= 0) identity.push(...rest.splice(at, 1));
    }
    if (identity.length === 0) return void 0;
    const tail = rest.length === 1 && rest[0] && groupChildren(rest[0]) !== void 0 ? rest[0] : { all: rest };
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
    if (key === "all" && children.length === 1 && only && groupChildren(only) !== void 0 && whereLead.length === 0 && children.findIndex((_c, i) => selectorClauseAt(facet, children, i) !== void 0) < 0)
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
  const tail = rest.length === 1 && rest[0] && groupChildren(rest[0]) !== void 0 ? rest[0] : { all: rest };
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
      const scopeLens = (0, import_json_rules2.exposedSurface)((0, import_json_rules2.createLens)({ maps: lens.maps, mapName, model: modelPart }));
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
      if (!(0, import_json_rules2.checkRuleAgainstLens)(facet.condition, lens).ok)
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
  const fields = (0, import_react.useMemo)(
    () => decoration ? describeFacets(lens, decoration, opts) : [],
    [lens, decoration, opts.targets, opts.labels, opts.valueLabels]
  );
  (0, import_react.useEffect)(() => {
    if (!decoration || process.env.NODE_ENV === "production") return;
    const violations = validateDecoration(lens, decoration);
    if (violations.length)
      console.warn(`[rules-builder] invalid Decoration:
- ${violations.join("\n- ")}`);
  }, [lens, decoration]);
  return fields;
};

// src/schema/lensValuePicker.ts
var import_json_rules3 = require("@inixiative/json-rules");
var import_react2 = require("react");
var RELATION_KINDS3 = /* @__PURE__ */ new Set(["object", "bridge"]);
var lensValuePicker = (lensOrNarrowing, opts = {}) => {
  const lens = (0, import_json_rules3.exposedSurface)(lensOrNarrowing);
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
  (0, import_react2.useMemo)(
    () => lensValuePicker(lensOrNarrowing, opts),
    [lensOrNarrowing, opts.mapName, opts.model, opts.maxDepth, opts.labels]
  )
);

// src/schema/sources.ts
var import_json_rules4 = require("@inixiative/json-rules");
var runSources = (lensOrNarrowing, rows) => (0, import_json_rules4.sourceQueries)(lensOrNarrowing).map((q) => {
  const matched = (rows[q.model] ?? []).filter((r) => (0, import_json_rules4.check)(q.composedWhere, r) === true);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  branchFields,
  consumedTopFields,
  decorationSurfaceOptions,
  describeFacets,
  describeModelFields,
  facetBranchScope,
  facetElementLeaf,
  facetId,
  isPreset,
  leadingIdentityCount,
  leadingWhereCount,
  lensValuePicker,
  matchFacet,
  modelDecor,
  modelFacets,
  relabelRelations,
  resolve,
  runSources,
  scopedDecoration,
  scopedFacetId,
  selectorsApply,
  stampFacetIds,
  useFacetFields,
  useLensValuePicker,
  validateDecoration,
  valueShapeForOperator,
  whereConditions,
  writeSelectorClause
});
//# sourceMappingURL=index.cjs.map