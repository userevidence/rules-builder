import { check, checkRuleAgainstLens, describeRule, exposedSurface } from '@inixiative/json-rules';
import { useEffect, useMemo, useState } from 'react';
import { type RuleBuilderSource, runSources } from '../../src';
import { RuleEditor } from '../RuleTree';
import { RuleEditorShadcn } from '../RuleTreeShadcn';
import { sampleRows } from '../samples';
import { Badge, Button, Code, EditorHeader, Empty, Panel, Row, Select, tokens } from '../ui';
import { type ParentRef, resolveRef } from '../workspace';
import type { TabProps } from './types';

type SourceChoice = { key: string; label: string; ref: ParentRef };
const refKey = (r: ParentRef) => `${r.kind}:${r.name}`;

export const BuilderTab = ({ ws, patch, selected }: TabProps & { selected?: string }) => {
  const choices = useMemo<SourceChoice[]>(
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

  const [sourceKey, setSourceKey] = useState('');
  const [renderer, setRenderer] = useState<'plain' | 'shadcn'>('shadcn');
  const [decorationName, setDecorationName] = useState('segment');
  const [ruleName, setRuleName] = useState('');
  const choice = choices.find((c) => c.key === sourceKey) ?? choices[0];

  // Selecting a saved rule from the inventory loads it: its draft + its bound source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react only to the selection
  useEffect(() => {
    if (selected && ws.rules[selected]) {
      const saved = ws.rules[selected];
      patch({ rule: saved.rule });
      setSourceKey(refKey(saved.source));
      setRuleName(selected);
    }
  }, [selected]);

  const analysis = useMemo(() => {
    if (!choice) return null;
    try {
      const resolved = resolveRef(ws, choice.ref);
      if (!resolved) throw new Error('surface not resolvable');
      // engine compiles the source queries; app runs them over sample rows → fetched values
      // fold into the projection so option sets reflect the lens/narrowing, not the raw column.
      const sourceValues = runSources(resolved, sampleRows);
      const surface = exposedSurface(resolved, { sourceValues });
      const source: RuleBuilderSource = {
        maps: surface.maps,
        mapName: surface.mapName,
        model: surface.model,
      };
      return {
        error: null as string | null,
        source,
        sourceValues,
        description: describeRule(ws.rule, surface),
        check: checkRuleAgainstLens(ws.rule, surface),
      };
    } catch (err) {
      return {
        error: String(err),
        source: null,
        sourceValues: [],
        description: null,
        check: null,
      };
    }
  }, [choice, ws]);

  if (!choice) {
    return (
      <Panel title="Builder">
        <Empty>Create a lens or narrowing first — the builder authors against one.</Empty>
      </Panel>
    );
  }

  const save = () => {
    const name = ruleName.trim();
    if (!name) return;
    patch({
      rules: {
        ...ws.rules,
        [name]: {
          source: choice.ref,
          rule: ws.rule,
          sourceValues: analysis?.sourceValues,
        },
      },
    });
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <EditorHeader
        title="Rule"
        name={ruleName}
        onName={setRuleName}
        namePlaceholder="rule name"
        saveLabel="Save rule"
        saveDisabled={!ruleName.trim()}
        onSave={save}
        extra={
          <Button variant="ghost" onClick={() => patch({ rule: { all: [] } })}>
            Reset
          </Button>
        }
      />

      <Panel title="Source">
        <Row>
          <label style={{ fontSize: 13, color: tokens.textMuted }}>Author against:</label>
          <Select
            ariaLabel="source"
            value={choice.key}
            onChange={setSourceKey}
            options={choices.map((c) => ({ value: c.key, label: c.label }))}
          />
          <label style={{ fontSize: 13, color: tokens.textMuted }}>Renderer:</label>
          <Select
            ariaLabel="renderer"
            value={renderer}
            onChange={(v) => setRenderer(v as 'plain' | 'shadcn')}
            options={[
              { value: 'shadcn', label: 'shadcn' },
              { value: 'plain', label: 'plain' },
            ]}
          />
          <label style={{ fontSize: 13, color: tokens.textMuted }}>Surface:</label>
          <Select
            ariaLabel="surface"
            value={ws.decorations[decorationName] ? decorationName : ''}
            onChange={setDecorationName}
            options={[
              { value: '', label: 'Raw (backend names)' },
              ...Object.keys(ws.decorations).map((n) => ({ value: n, label: `decorated · ${n}` })),
            ]}
          />
          <span style={{ fontSize: 12, color: tokens.textMuted }}>
            depth {ws.maxDepth} · set in Settings
          </span>
        </Row>
      </Panel>

      <Panel title="Rule">
        {analysis?.error ? (
          <Badge tone="danger">{analysis.error}</Badge>
        ) : analysis?.source && renderer === 'shadcn' ? (
          <RuleEditorShadcn
            key={`${choice.key}:${decorationName}`}
            source={analysis.source}
            sourceValues={analysis.sourceValues}
            maxDepth={ws.maxDepth}
            rule={ws.rule}
            onChange={(rule) => patch({ rule })}
            decoration={ws.decorations[decorationName]}
          />
        ) : analysis?.source ? (
          <RuleEditor
            key={`${choice.key}:${decorationName}`}
            source={analysis.source}
            sourceValues={analysis.sourceValues}
            maxDepth={ws.maxDepth}
            rule={ws.rule}
            onChange={(rule) => patch({ rule })}
            decoration={ws.decorations[decorationName]}
          />
        ) : null}
      </Panel>

      {analysis?.description && analysis.check && (
        <Panel title="Classification">
          <Row>
            <Badge tone="accent">sources: {analysis.description.sources.join(', ') || '—'}</Badge>
            <Badge tone={analysis.description.bridgesCrossed ? 'danger' : 'muted'}>
              bridgesCrossed: {String(analysis.description.bridgesCrossed)}
            </Badge>
            <Badge tone="muted">
              targets: {analysis.description.supportedTargets.join(', ') || '—'}
            </Badge>
            <Badge tone={analysis.check.ok ? 'ok' : 'danger'}>
              checkRuleAgainstLens:{' '}
              {analysis.check.ok ? 'ok' : `${analysis.check.violations.length} violation(s)`}
            </Badge>
          </Row>
          {!analysis.check.ok && (
            <div style={{ display: 'grid', gap: 4 }}>
              {analysis.check.violations.map((v, i) => (
                <Badge key={`${v.path}-${i}`} tone="danger">
                  {v.path}: {v.reason}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      )}

      {analysis?.source && (sampleRows[analysis.source.model]?.length ?? 0) > 0 && (
        <Panel title={`Evaluate — sample ${analysis.source.model} rows (check, in memory)`}>
          <div style={{ display: 'grid', gap: 4 }}>
            {sampleRows[analysis.source.model].map((r, i) => {
              const result = (() => {
                try {
                  return check(ws.rule, r);
                } catch (err) {
                  return String(err);
                }
              })();
              const matched = result === true;
              return (
                <Row key={String(r.id ?? i)}>
                  <Badge tone={matched ? 'ok' : 'muted'}>{matched ? '✓ match' : '✗'}</Badge>
                  <code style={{ fontSize: 11, color: tokens.textMuted }}>{JSON.stringify(r)}</code>
                  {typeof result === 'string' && (
                    <span style={{ fontSize: 11, color: tokens.textMuted }}>{result}</span>
                  )}
                </Row>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="Condition JSON">
        <Code>{JSON.stringify(ws.rule, null, 2)}</Code>
      </Panel>
    </div>
  );
};
