import { useState } from 'react';
import { defaultWorkspace } from './samples';
import { BridgesTab } from './tabs/BridgesTab';
import { BuilderTab } from './tabs/BuilderTab';
import { DecorationsTab } from './tabs/DecorationsTab';
import { DocsTab } from './tabs/DocsTab';
import { FieldmapsTab } from './tabs/FieldmapsTab';
import { LensEditor } from './tabs/LensEditor';
import { NarrowingEditor } from './tabs/NarrowingEditor';
import { PathPickerTab } from './tabs/PathPickerTab';
import { PermissionsTab } from './tabs/PermissionsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { TransitionsTab } from './tabs/TransitionsTab';
import { tokens } from './ui';
import type { Workspace } from './workspace';

type Section =
  | 'fieldmaps'
  | 'bridges'
  | 'lenses'
  | 'narrowings'
  | 'rules'
  | 'decorations'
  | 'permissions'
  | 'transitions'
  | 'valuepicker'
  | 'docs'
  | 'settings';
type Selection = { section: Section; item?: string };
type InvItem = { id: string; label: string };
type SectionDef = { key: Section; label: string; items: InvItem[] };

const bridgeLabel = (b: Workspace['bridges'][number]) =>
  `${b.endpoints[0].fieldMap}:${b.endpoints[0].model} ↔ ${b.endpoints[1].fieldMap}:${b.endpoints[1].model}`;

const inventorySections = (ws: Workspace): SectionDef[] => [
  {
    key: 'fieldmaps',
    label: 'FieldMaps',
    items: Object.keys(ws.maps).map((m) => ({ id: m, label: m })),
  },
  {
    key: 'bridges',
    label: 'Bridges',
    items: ws.bridges.map((b, i) => ({ id: String(i), label: bridgeLabel(b) })),
  },
  {
    key: 'lenses',
    label: 'Lenses',
    items: Object.keys(ws.lenses).map((n) => ({ id: n, label: n })),
  },
  {
    key: 'narrowings',
    label: 'Narrowings',
    items: Object.entries(ws.narrowings).map(([n, sn]) => ({
      id: n,
      label: `${n} ← ${sn.parent.name}`,
    })),
  },
];

const builderSections = (ws: Workspace): SectionDef[] => [
  { key: 'rules', label: 'Rules', items: Object.keys(ws.rules).map((n) => ({ id: n, label: n })) },
  {
    key: 'decorations',
    label: 'Decorations',
    items: Object.keys(ws.decorations).map((n) => ({ id: n, label: n })),
  },
  {
    key: 'permissions',
    label: 'Permissions',
    items: Object.keys(ws.permissions).map((r) => ({ id: r, label: r })),
  },
  {
    key: 'transitions',
    label: 'Transitions',
    items: Object.keys(ws.transitions).map((r) => ({ id: r, label: r })),
  },
];

export const App = () => {
  const [ws, setWs] = useState<Workspace>(defaultWorkspace);
  const [sel, setSel] = useState<Selection>({ section: 'fieldmaps' });

  const patch = (partial: Partial<Workspace>) => setWs((prev) => ({ ...prev, ...partial }));

  const selectItem = (section: Section, id: string) => {
    // Rules/Permissions load their selection inside their tab via the `selected` prop.
    setSel({ section, item: id });
  };

  const removeItem = (section: Section, id: string) => {
    if (section === 'fieldmaps') {
      const { [id]: _, ...rest } = ws.maps;
      patch({ maps: rest });
    } else if (section === 'bridges') {
      patch({ bridges: ws.bridges.filter((_, i) => String(i) !== id) });
    } else if (section === 'lenses') {
      const { [id]: _, ...rest } = ws.lenses;
      patch({ lenses: rest });
    } else if (section === 'narrowings') {
      const { [id]: _, ...rest } = ws.narrowings;
      patch({ narrowings: rest });
    } else if (section === 'rules') {
      const { [id]: _, ...rest } = ws.rules;
      patch({ rules: rest });
    } else if (section === 'decorations') {
      const { [id]: _, ...rest } = ws.decorations;
      patch({ decorations: rest });
    } else if (section === 'permissions') {
      const { [id]: _, ...rest } = ws.permissions;
      patch({ permissions: rest });
    } else if (section === 'transitions') {
      const { [id]: _, ...rest } = ws.transitions;
      patch({ transitions: rest });
    }
    setSel((s) => (s.section === section && s.item === id ? { section } : s));
  };

  const editor = (() => {
    switch (sel.section) {
      case 'fieldmaps':
        return <FieldmapsTab ws={ws} patch={patch} selected={sel.item} />;
      case 'bridges':
        return <BridgesTab ws={ws} patch={patch} />;
      case 'lenses':
        return <LensEditor ws={ws} patch={patch} selected={sel.item} />;
      case 'narrowings':
        return <NarrowingEditor ws={ws} patch={patch} selected={sel.item} />;
      case 'rules':
        return <BuilderTab ws={ws} patch={patch} selected={sel.item} />;
      case 'decorations':
        return <DecorationsTab ws={ws} patch={patch} selected={sel.item} />;
      case 'permissions':
        return <PermissionsTab ws={ws} patch={patch} selected={sel.item} />;
      case 'transitions':
        return <TransitionsTab ws={ws} patch={patch} selected={sel.item} />;
      case 'valuepicker':
        return <PathPickerTab ws={ws} patch={patch} />;
      case 'docs':
        return <DocsTab />;
      case 'settings':
        return <SettingsTab ws={ws} patch={patch} replace={setWs} />;
    }
  })();

  const navItem = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    padding: '5px 8px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    background: active ? tokens.accentBg : 'transparent',
    color: active ? tokens.accent : tokens.text,
    fontWeight: active ? 600 : 400,
    border: 'none',
    width: '100%',
    textAlign: 'left',
  });

  const labelBtn: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const groupLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: tokens.textMuted,
  };

  const renderSection = (s: SectionDef) => (
    <div key={s.key} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <button
        type="button"
        style={navItem(sel.section === s.key && !sel.item)}
        onClick={() => setSel({ section: s.key })}
      >
        <span>{s.label}</span>
        <span style={{ fontSize: 11, color: tokens.textMuted }}>{s.items.length}</span>
      </button>
      {s.items.map((it) => (
        <div
          key={it.id}
          style={{
            ...navItem(sel.section === s.key && sel.item === it.id),
            paddingLeft: 18,
            fontSize: 12,
            minWidth: 0,
          }}
        >
          <button type="button" onClick={() => selectItem(s.key, it.id)} style={labelBtn}>
            {it.label}
          </button>
          <button
            type="button"
            aria-label={`remove ${it.label}`}
            title="remove"
            onClick={() => removeItem(s.key, it.id)}
            style={{
              flexShrink: 0,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: tokens.textMuted,
              padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        color: tokens.text,
        background: tokens.bgMuted,
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          padding: '14px 20px',
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bg,
        }}
      >
        <strong style={{ fontSize: 16 }}>Rules Builder</strong>
        <span style={{ fontSize: 12, color: tokens.textMuted }}>
          inventory (maps · bridges · lenses · narrowings) → builders (rules · permissions)
        </span>
      </header>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          padding: 20,
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <nav
          style={{
            width: 240,
            flexShrink: 0,
            position: 'sticky',
            top: 20,
            maxHeight: 'calc(100vh - 40px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflow: 'hidden',
            background: tokens.bg,
            border: `1px solid ${tokens.border}`,
            borderRadius: tokens.radius,
            padding: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              overflowY: 'auto',
              minHeight: 0,
            }}
          >
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <div style={groupLabel}>INVENTORY</div>
              {inventorySections(ws).map(renderSection)}
            </div>
            <div
              style={{
                display: 'grid',
                gap: 4,
                minWidth: 0,
                borderTop: `1px solid ${tokens.border}`,
                paddingTop: 10,
              }}
            >
              <div style={groupLabel}>BUILDERS</div>
              {builderSections(ws).map(renderSection)}
            </div>
            <div
              style={{
                display: 'grid',
                gap: 2,
                minWidth: 0,
                borderTop: `1px solid ${tokens.border}`,
                paddingTop: 10,
              }}
            >
              <div style={groupLabel}>TOOLS</div>
              <button
                type="button"
                style={navItem(sel.section === 'valuepicker')}
                onClick={() => setSel({ section: 'valuepicker' })}
              >
                <span>Value Picker</span>
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 'auto',
              borderTop: `1px solid ${tokens.border}`,
              paddingTop: 8,
              display: 'grid',
              gap: 2,
              minWidth: 0,
            }}
          >
            <button
              type="button"
              style={navItem(sel.section === 'docs')}
              onClick={() => setSel({ section: 'docs' })}
            >
              <span>📖 Docs</span>
            </button>
            <button
              type="button"
              style={navItem(sel.section === 'settings')}
              onClick={() => setSel({ section: 'settings' })}
            >
              <span>⚙ Settings</span>
            </button>
          </div>
        </nav>

        <main style={{ flex: 1, minWidth: 0 }}>{editor}</main>
      </div>
    </div>
  );
};
