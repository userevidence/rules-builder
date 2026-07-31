import type { Condition, SourceValues } from '@inixiative/json-rules';
import { useState } from 'react';
import {
  type ArrayNode,
  type BuilderNode,
  type Decoration,
  type FacetModeControl,
  type GroupNode,
  type LeafNode,
  type RuleBuilderSource,
  useRuleBuilder,
  type ValueControl,
} from '../src';
import { Badge, Button, Input, MultiSelect, Select } from './shadcn';

/** Fold a field option's icon into its label — the shadcn <Select> renders plain
 *  <option>s, so a {@link Decoration}'s icon rides along in the text. */
const iconize = (options: readonly { value: string; label: string; icon?: string }[]) =>
  options.map((o) => ({ value: o.value, label: o.icon ? `${o.icon}  ${o.label}` : o.label }));

/**
 * shadcn-style drop-in renderer for the headless rule builder — the SAME `root`
 * descriptors as the plain RuleTree, wired to Tailwind/shadcn primitives (mirroring
 * @template/ui). Copy this, point the imports at your own `@/components/ui`, done.
 */

const LiteralValue = ({ value }: { value: ValueControl }) => {
  if (value.options) {
    if (value.shape === 'array' || value.shape === 'dayList') {
      const current = Array.isArray(value.current) ? (value.current as string[]) : [];
      return (
        <MultiSelect
          aria-label="value"
          options={value.options}
          value={current}
          onChange={value.set}
        />
      );
    }
    return (
      <Select
        aria-label="value"
        placeholder="value"
        options={value.options}
        value={value.current == null ? '' : String(value.current)}
        onChange={value.set}
      />
    );
  }
  if (value.kind === 'Boolean') {
    return (
      <Select
        aria-label="value"
        placeholder="value"
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        value={value.current === true ? 'true' : value.current === false ? 'false' : ''}
        onChange={(v) => value.set(v === 'true')}
      />
    );
  }
  if (value.kind === 'DateTime') {
    return (
      <Input
        aria-label="value"
        type="date"
        value={typeof value.current === 'string' ? value.current.slice(0, 10) : ''}
        onChange={(e) => value.set(e.target.value)}
      />
    );
  }
  const numeric = value.kind === 'Int' || value.kind === 'Float' || value.kind === 'Decimal';
  return (
    <Input
      aria-label="value"
      type={numeric ? 'number' : 'text'}
      value={value.current == null ? '' : String(value.current)}
      onChange={(e) =>
        value.set(
          numeric ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value,
        )
      }
    />
  );
};

const ValueField = ({ value }: { value: ValueControl }) => {
  if (value.shape === 'none') return null;
  return (
    <>
      <Select
        aria-label="value mode"
        options={[
          { value: 'value', label: '= value' },
          { value: 'path', label: '→ field' },
          { value: 'bind', label: '⟐ bind' },
        ]}
        value={value.mode}
        onChange={(m) => value.setMode(m as 'value' | 'path' | 'bind')}
      />
      {value.mode === 'path' ? (
        <Input
          aria-label="path"
          placeholder="field.path"
          value={value.path?.value ?? ''}
          onChange={(e) => value.path?.set(e.target.value)}
        />
      ) : value.mode === 'bind' ? (
        <Input
          aria-label="bind"
          placeholder="bindName"
          value={value.bind?.value ?? ''}
          onChange={(e) => value.bind?.set(e.target.value)}
        />
      ) : (
        <LiteralValue value={value} />
      )}
    </>
  );
};

const Leaf = ({ node }: { node: LeafNode }) => (
  <div className="flex flex-wrap items-center gap-1.5" aria-invalid={!node.valid}>
    <Select
      aria-label="leaf kind"
      options={[
        { value: 'field', label: 'field' },
        { value: 'boolean', label: 'true/false' },
      ]}
      value={node.leafKind}
      onChange={(k) => node.setLeafKind(k as 'field' | 'boolean')}
    />
    {node.leafKind === 'boolean' && node.literal ? (
      <Select
        aria-label="boolean value"
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        value={String(node.literal.value)}
        onChange={(v) => node.literal?.set(v === 'true')}
      />
    ) : (
      node.field &&
      node.operator &&
      node.value && (
        <>
          <Select
            aria-label="field"
            placeholder="field"
            options={iconize(node.field.options)}
            value={node.field.value ?? ''}
            onChange={node.field.set}
          />
          {node.field.acceptsSubPath && node.field.setSubPath && (
            <Input
              aria-label="json sub-path"
              placeholder="json.path"
              value={node.field.subPath ?? ''}
              onChange={(e) => node.field?.setSubPath?.(e.target.value)}
            />
          )}
          <Select
            aria-label="operator"
            placeholder="operator"
            options={node.operator.options}
            value={node.operator.value ?? ''}
            onChange={node.operator.set}
          />
          <ValueField value={node.value} />
        </>
      )
    )}
    {!node.valid && (
      <Badge tone="danger" title="value not in the allowed set">
        ✗
      </Badge>
    )}
    <Button aria-label="remove" variant="ghost" size="icon" onClick={node.remove}>
      ✕
    </Button>
  </div>
);

const AggregateFacet = ({ node }: { node: ArrayNode }) => {
  const agg = node.aggregate;
  if (!agg) return null;
  const isRange = agg.value.shape === 'range';
  const value = agg.value.current;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        aria-label="aggregate mode"
        options={agg.modeOptions}
        value={agg.mode}
        onChange={(m) => agg.setMode(m as 'sum' | 'avg')}
      />
      <span className="text-xs text-muted-foreground">of</span>
      <Select
        aria-label="aggregate field"
        placeholder="numeric field"
        options={iconize(agg.field.options)}
        value={agg.field.value ?? ''}
        onChange={agg.field.set}
      />
      {/* A Json target runs via check() but cannot compile to a Prisma groupBy. */}
      {agg.field.compilesToPrisma === false && (
        <Badge tone="accent" title="Json aggregate runs via check() but cannot compile to Prisma">
          check()-only (Json)
        </Badge>
      )}
      <Select
        aria-label="aggregate operator"
        placeholder="operator"
        options={agg.operator.options}
        value={agg.operator.value ?? ''}
        onChange={agg.operator.set}
      />
      {isRange ? (
        <>
          <Input
            aria-label="aggregate value min"
            type="number"
            className="w-20"
            value={Array.isArray(value) ? (value[0] ?? '') : ''}
            onChange={(e) =>
              agg.value.set([Number(e.target.value), Array.isArray(value) ? value[1] : 0])
            }
          />
          <Input
            aria-label="aggregate value max"
            type="number"
            className="w-20"
            value={Array.isArray(value) ? (value[1] ?? '') : ''}
            onChange={(e) =>
              agg.value.set([Array.isArray(value) ? value[0] : 0, Number(e.target.value)])
            }
          />
        </>
      ) : (
        <Input
          aria-label="aggregate value"
          type="number"
          className="w-24"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) =>
            agg.value.set(e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      )}
    </div>
  );
};

const FacetModeToggle = ({ mode }: { mode?: FacetModeControl }) =>
  mode ? (
    <Button
      aria-label="facet mode"
      variant="ghost"
      size="sm"
      className="text-[10px] text-muted-foreground"
      title={mode.value === 'faceted' ? 'detach: edit the raw structure' : 're-attach the facet'}
      onClick={() => mode.set(mode.value === 'faceted' ? 'raw' : 'faceted')}
    >
      {mode.value === 'faceted' ? '⚙ raw' : '↩ facet'}
    </Button>
  ) : null;

type SelectorDecl = { field: string; label?: string; anyLabel?: string };
const clauseField = (c: BuilderNode): string | undefined => {
  if (c.kind === 'leaf')
    return c.field?.subPath ? `${c.field.value}.${c.field.subPath}` : c.field?.value;
  if (c.kind === 'group') return clauseField(c.children[0] as BuilderNode);
  return undefined;
};

// The facet's own knobs: one dropdown per declared selector, reading through the
// hoisted clause node and writing through the seam. anyLabel clears (null).
const Selectors = ({
  selectors,
  clauses,
  set,
}: {
  selectors?: SelectorDecl[];
  clauses?: BuilderNode[];
  set?: (field: string, value: unknown | null) => void;
}) => {
  if (!selectors?.length || !set) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selectors.map((sel) => {
        const clause = clauses?.find((c) => clauseField(c) === sel.field);
        const leaf = clause?.kind === 'leaf' ? clause : undefined;
        const current = leaf?.value?.current;
        return (
          <div key={sel.field} className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {sel.label ?? sel.field}
            </span>
            {clause && !leaf ? (
              // A complex clause (OR block) renders as its group + a clear.
              <>
                <Node node={clause} />
                <Button variant="ghost" size="sm" onClick={() => set(sel.field, null)}>
                  {sel.anyLabel ?? 'any'}
                </Button>
              </>
            ) : leaf?.value?.options ? (
              <Select
                aria-label={sel.label ?? sel.field}
                options={[{ value: '', label: sel.anyLabel ?? 'any' }, ...leaf.value.options]}
                value={current == null ? '' : String(current)}
                onChange={(v) => set(sel.field, v === '' ? null : v)}
              />
            ) : (
              <Input
                aria-label={sel.label ?? sel.field}
                className="w-28"
                placeholder={sel.anyLabel ?? 'any'}
                value={current == null ? '' : String(current)}
                onChange={(e) => set(sel.field, e.target.value === '' ? null : e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ArrayRule = ({ node }: { node: ArrayNode }) => (
  <div
    className="grid gap-1.5 rounded-md border border-border border-l-2 border-l-violet-500 bg-violet-50/40 p-2"
    aria-invalid={!node.valid}
  >
    <div className="flex flex-wrap items-center gap-1.5">
      {node.hoist ? (
        // A hoisted facet collapses to its name — the fixed `where` is its identity,
        // so there is nothing to pick; the badge IS the field.
        <span className="text-xs font-semibold">
          {node.hoist.icon ? `${node.hoist.icon}  ` : ''}
          {node.hoist.label}
        </span>
      ) : (
        <>
          <Select
            aria-label="field"
            placeholder="field"
            options={iconize(node.field.options)}
            value={node.field.value ?? ''}
            onChange={node.field.set}
          />
          {node.arrayOperator && (
            <Select
              aria-label="array operator"
              placeholder="operator"
              options={node.arrayOperator.options}
              value={node.arrayOperator.value ?? ''}
              onChange={node.arrayOperator.set}
            />
          )}
          {node.aggregate && <AggregateFacet node={node} />}
        </>
      )}
      {node.count && (
        <Input
          aria-label="count"
          type="number"
          className="w-20"
          value={node.count.value ?? ''}
          onChange={(e) =>
            node.count?.set(e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      )}
      {!node.hoist && node.relation && (
        <span className="text-xs text-violet-600">↪ {node.relation.modelName}</span>
      )}
      {!node.valid && <Badge tone="danger">✗</Badge>}
      <div className="ml-auto flex items-center gap-1">
        <FacetModeToggle mode={node.facetMode} />
        <Button aria-label="remove" variant="ghost" size="icon" onClick={node.remove}>
          ✕
        </Button>
      </div>
    </div>

    <Selectors
      selectors={node.selectors}
      clauses={node.selectorClauses}
      set={node.setSelectorClause}
    />

    {node.condition && (
      <div className="grid gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {node.aggregate ? 'over elements where' : `${node.arrayOperator?.value} element matches`}
        </span>
        <Node node={node.condition} />
      </div>
    )}

    {node.filter &&
      (node.filter.children.length > 0 ? (
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              filter — only elements where
            </span>
            {node.removeFilter && (
              <Button variant="ghost" size="sm" onClick={node.removeFilter}>
                clear filter
              </Button>
            )}
          </div>
          <Node node={node.filter} />
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={node.filter.addRule}
        >
          + element filter
        </Button>
      ))}
  </div>
);

const Group = ({ node }: { node: GroupNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  // A group's display name: its facet's label (a hoisted branch) or the retagged
  // root/anchor model (`labels.models`). A facet's fixed `where` is identity, not
  // user content — the builder already presents only the user-rows surface, so
  // children render as-is; there is nothing to hide.
  const title = node.hoist?.label ?? node.label;
  const visible = node.children;
  return (
    <div
      className={`rounded-md border border-border border-l-2 p-2 ${node.depth ? 'ml-3 border-l-muted-foreground/40 bg-muted/30' : 'border-l-primary'}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label="collapse"
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▸' : '▾'}
        </Button>
        {title && <span className="text-xs font-semibold">{title}</span>}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          conditions — match
        </span>
        <Select
          aria-label="match type"
          options={[
            { value: 'all', label: 'All (AND)' },
            { value: 'any', label: 'Any (OR)' },
          ]}
          value={node.operator.value}
          onChange={(v) => node.operator.set(v === 'any' ? 'any' : 'all')}
        />
        <FacetModeToggle mode={node.facetMode} />
        {node.remove && (
          <Button variant="ghost" size="icon" aria-label="remove group" onClick={node.remove}>
            ✕
          </Button>
        )}
      </div>
      <Selectors
        selectors={node.selectors}
        clauses={node.selectorClauses}
        set={node.setSelectorClause}
      />
      {!collapsed && (
        <div className="mt-1.5 grid gap-1.5">
          {visible.map((c) => (
            <Node key={c.id} node={c} />
          ))}
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" onClick={node.addRule}>
              + rule
            </Button>
            {node.canAddGroup && (
              <Button variant="outline" size="sm" onClick={node.addGroup}>
                + group
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const Node = ({ node }: { node: BuilderNode }) =>
  node.kind === 'group' ? (
    <Group node={node} />
  ) : node.kind === 'array' ? (
    <ArrayRule node={node} />
  ) : (
    <Leaf node={node} />
  );

export const RuleTreeShadcn = ({ root }: { root: BuilderNode }) => <Node node={root} />;

export const RuleEditorShadcn = ({
  source,
  sourceValues,
  rule,
  onChange,
  maxDepth,
  decoration,
}: {
  source: RuleBuilderSource;
  sourceValues?: SourceValues[];
  rule?: Condition;
  onChange?: (rule: Condition) => void;
  maxDepth?: number;
  decoration?: Decoration;
}) => {
  const { root } = useRuleBuilder({
    source,
    sourceValues,
    defaultValue: rule,
    onChange,
    maxDepth,
    decoration,
  });
  return <RuleTreeShadcn root={root} />;
};
