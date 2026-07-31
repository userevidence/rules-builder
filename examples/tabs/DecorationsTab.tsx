import { exposedSurface } from '@inixiative/json-rules';
import { useEffect, useMemo, useState } from 'react';
import { type Decoration, type Facet, validateDecoration } from '../../src';
import { Badge, Button, Code, EditorHeader, Empty, Panel, Row, Select, tokens } from '../ui';
import { type ParentRef, resolveRef } from '../workspace';
import type { TabProps } from './types';

const inputStyle = {
  padding: '5px 8px',
  borderRadius: 6,
  border: `1px solid ${tokens.borderStrong}`,
  fontSize: 12,
} as const;

const Text = ({
  value,
  onChange,
  placeholder,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
}) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    aria-label={placeholder}
    style={{ ...inputStyle, width: width ?? 130 }}
  />
);

/** `where` edits as JSON (compound wheres and OR-block identities stay expressible). */
const parseJson = (text: string): { value?: unknown; error?: string } => {
  if (!text.trim()) return { value: undefined };
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: String(err) };
  }
};

const FacetCard = ({
  facet,
  onChange,
  onRemove,
}: {
  facet: Facet;
  onChange: (next: Facet) => void;
  onRemove: () => void;
}) => {
  const [whereText, setWhereText] = useState(facet.where ? JSON.stringify(facet.where) : '');
  const whereParse = parseJson(whereText);
  const selectors = facet.selectors ?? [];
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: 8,
        borderRadius: 8,
        border: `1px solid ${tokens.borderStrong}`,
      }}
    >
      <Row>
        <Text
          value={facet.label ?? ''}
          onChange={(v) => onChange({ ...facet, label: v || undefined })}
          placeholder="label"
        />
        <Text
          value={facet.icon ?? ''}
          onChange={(v) => onChange({ ...facet, icon: v || undefined })}
          placeholder="icon"
          width={50}
        />
        <Text
          value={facet.path ?? ''}
          onChange={(v) => onChange({ ...facet, path: v || undefined })}
          placeholder="path (dotted)"
          width={190}
        />
        <Button variant="ghost" onClick={onRemove}>
          ✕
        </Button>
      </Row>
      <Row>
        <span style={{ fontSize: 11, color: tokens.textMuted }}>where</span>
        <input
          value={whereText}
          onChange={(e) => {
            setWhereText(e.target.value);
            const parsed = parseJson(e.target.value);
            if (!parsed.error)
              onChange({ ...facet, where: parsed.value as Facet['where'] | undefined });
          }}
          placeholder='{"field":"key","operator":"equals","value":"nps"}'
          aria-label="where"
          style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
        />
        {whereParse.error && <Badge tone="danger">bad JSON</Badge>}
      </Row>
      <Row>
        <span style={{ fontSize: 11, color: tokens.textMuted }}>selectors</span>
        {selectors.map((sel, i) => (
          <Row key={`${sel.field}-${i}`}>
            <Text
              value={sel.field}
              onChange={(v) => {
                const next = selectors.map((x, j) => (j === i ? { ...x, field: v } : x));
                onChange({ ...facet, selectors: next });
              }}
              placeholder="field"
              width={110}
            />
            <Text
              value={sel.label ?? ''}
              onChange={(v) => {
                const next = selectors.map((x, j) =>
                  j === i ? { ...x, label: v || undefined } : x,
                );
                onChange({ ...facet, selectors: next });
              }}
              placeholder="label"
              width={90}
            />
            <Text
              value={sel.anyLabel ?? ''}
              onChange={(v) => {
                const next = selectors.map((x, j) =>
                  j === i ? { ...x, anyLabel: v || undefined } : x,
                );
                onChange({ ...facet, selectors: next });
              }}
              placeholder="any label"
              width={90}
            />
            <Button
              variant="ghost"
              onClick={() => {
                const next = selectors.filter((_x, j) => j !== i);
                onChange({ ...facet, selectors: next.length ? next : undefined });
              }}
            >
              ✕
            </Button>
          </Row>
        ))}
        <Button
          variant="ghost"
          onClick={() => onChange({ ...facet, selectors: [...selectors, { field: '' }] })}
        >
          + selector
        </Button>
      </Row>
    </div>
  );
};

const FacetList = ({
  facets,
  onChange,
}: {
  facets: Facet[];
  onChange: (next: Facet[]) => void;
}) => (
  <div style={{ display: 'grid', gap: 8 }}>
    {facets.map((f, i) => (
      <FacetCard
        // biome-ignore lint/suspicious/noArrayIndexKey: positional editor rows
        key={i}
        facet={f}
        onChange={(next) => onChange(facets.map((x, j) => (j === i ? next : x)))}
        onRemove={() => onChange(facets.filter((_x, j) => j !== i))}
      />
    ))}
    <Button variant="ghost" onClick={() => onChange([...facets, { label: 'New facet' }])}>
      + facet
    </Button>
  </div>
);

export const DecorationsTab = ({ ws, patch, selected }: TabProps & { selected?: string }) => {
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Decoration>({ facets: [] });
  const [newScope, setNewScope] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to the selection
  useEffect(() => {
    if (selected && ws.decorations[selected]) {
      setName(selected);
      setDraft(ws.decorations[selected]);
    }
  }, [selected]);

  const choices = useMemo<{ key: string; label: string; ref: ParentRef }[]>(
    () => [
      ...Object.keys(ws.lenses).map((n) => ({
        key: `lens:${n}`,
        label: `lens · ${n}`,
        ref: { kind: 'lens' as const, name: n },
      })),
      ...Object.keys(ws.narrowings).map((n) => ({
        key: `narrowing:${n}`,
        label: `narrowing · ${n}`,
        ref: { kind: 'narrowing' as const, name: n },
      })),
    ],
    [ws.lenses, ws.narrowings],
  );
  const [againstKey, setAgainstKey] = useState('');
  const against = choices.find((c) => c.key === againstKey) ?? choices[0];

  const violations = useMemo(() => {
    if (!against) return null;
    try {
      const resolved = resolveRef(ws, against.ref);
      if (!resolved) return ['surface not resolvable'];
      return validateDecoration(exposedSurface(resolved), draft);
    } catch (err) {
      return [String(err)];
    }
  }, [against, draft, ws]);

  const models = draft.models ?? {};

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <EditorHeader
        title="Decoration"
        name={name}
        onName={setName}
        namePlaceholder="decoration name"
        saveLabel="Save decoration"
        saveDisabled={!name.trim()}
        onSave={() => patch({ decorations: { ...ws.decorations, [name.trim()]: draft } })}
        extra={
          <Button variant="ghost" onClick={() => setDraft({ facets: [] })}>
            Reset
          </Button>
        }
      />

      <Panel title="Anchor facets — the root picker's curated entries">
        <FacetList facets={draft.facets} onChange={(facets) => setDraft({ ...draft, facets })} />
      </Panel>

      {Object.entries(models).map(([scope, facets]) => (
        <Panel
          key={scope}
          title={
            <Row>
              <span>
                models · {scope} — applied at every {scope} surface, any depth
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  const { [scope]: _gone, ...rest } = models;
                  setDraft({ ...draft, models: Object.keys(rest).length ? rest : undefined });
                }}
              >
                remove scope
              </Button>
            </Row>
          }
        >
          <FacetList
            facets={facets}
            onChange={(next) => setDraft({ ...draft, models: { ...models, [scope]: next } })}
          />
        </Panel>
      ))}

      <Panel title="Add model scope">
        <Row>
          <Text
            value={newScope}
            onChange={setNewScope}
            placeholder="Model or map:Model"
            width={200}
          />
          <Button
            variant="ghost"
            disabled={!newScope.trim() || !!models[newScope.trim()]}
            onClick={() => {
              setDraft({ ...draft, models: { ...models, [newScope.trim()]: [] } });
              setNewScope('');
            }}
          >
            + scope
          </Button>
        </Row>
      </Panel>

      {against && violations && (
        <Panel title="Validation">
          <Row>
            <span style={{ fontSize: 13, color: tokens.textMuted }}>against:</span>
            <Select
              ariaLabel="validate against"
              value={against.key}
              onChange={setAgainstKey}
              options={choices.map((c) => ({ value: c.key, label: c.label }))}
            />
            <Badge tone={violations.length ? 'danger' : 'ok'}>
              {violations.length ? `${violations.length} violation(s)` : 'valid'}
            </Badge>
          </Row>
          {violations.length > 0 && (
            <div style={{ display: 'grid', gap: 4 }}>
              {violations.map((v) => (
                <Badge key={v} tone="danger">
                  {v}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      )}

      <Panel title="Decoration JSON">
        <Code>{JSON.stringify(draft, null, 2)}</Code>
      </Panel>
    </div>
  );
};
