import type { Bridge, FieldMap } from '@inixiative/json-rules';
import type { Decoration } from '../src';
import type { SavedLens, SavedNarrowing, Workspace } from './workspace';
import { emptyWorkspace } from './workspace';

/** Two sources so bridges connect across maps and sources have somewhere to land. */
export const sampleMaps: Record<string, FieldMap> = {
  app: {
    models: {
      User: {
        fields: {
          id: { kind: 'scalar', type: 'Int' },
          email: { kind: 'scalar', type: 'String' },
          age: { kind: 'scalar', type: 'Int' },
          role: { kind: 'enum', type: 'UserRole' },
          tier: { kind: 'scalar', type: 'String' }, // sourced → pseudo-enum
          active: { kind: 'scalar', type: 'Boolean' },
          metadata: { kind: 'scalar', type: 'Json' }, // freeform sub-path (metadata.theme)
          createdAt: { kind: 'scalar', type: 'DateTime' },
          accountId: { kind: 'scalar', type: 'Int' },
          orders: { kind: 'object', type: 'Order', isList: true },
          // The real advocacy data lives here: an EAV key/value list. Raw, this
          // reads as "enrichments → key/value" — the backend-name regression. A
          // Decoration collapses `enrichments where key='nps'` into one field "NPS".
          enrichments: { kind: 'object', type: 'Enrichment', isList: true },
        },
      },
      Enrichment: {
        fields: {
          key: { kind: 'scalar', type: 'String' },
          value: { kind: 'scalar', type: 'String' }, // untyped column; a facet `kind` override types it
        },
      },
      Order: {
        fields: {
          id: { kind: 'scalar', type: 'Int' },
          total: { kind: 'scalar', type: 'Float' },
          status: { kind: 'enum', type: 'OrderStatus' },
          placedAt: { kind: 'scalar', type: 'DateTime' },
          userId: { kind: 'scalar', type: 'Int' },
        },
      },
    },
    enums: {
      UserRole: ['admin', 'member', 'guest'],
      OrderStatus: ['pending', 'paid', 'shipped', 'canceled'],
    },
  },
  crm: {
    models: {
      Account: {
        fields: {
          id: { kind: 'scalar', type: 'Int' },
          name: { kind: 'scalar', type: 'String' },
          industry: { kind: 'scalar', type: 'String' }, // sourced → pseudo-enum
          tier: { kind: 'enum', type: 'AccountTier' },
          ownerEmail: { kind: 'scalar', type: 'String' },
        },
      },
      Contact: {
        fields: {
          id: { kind: 'scalar', type: 'Int' },
          email: { kind: 'scalar', type: 'String' },
          accountId: { kind: 'scalar', type: 'Int' },
        },
      },
    },
    enums: { AccountTier: ['smb', 'mid', 'enterprise'] },
  },
};

/** One Account (the "one") fans out to many app Users (the "many"). */
export const sampleBridges: Bridge[] = [
  {
    endpoints: [
      { fieldMap: 'crm', model: 'Account', on: 'id' },
      { fieldMap: 'app', model: 'User', on: 'accountId' },
    ],
    cardinality: 'oneToMany',
  },
];

/**
 * Stand-in for the DB: rows per model. A source's options are the DISTINCT
 * values of its column across these rows (after the eligibility `where`), so a
 * field's option set is its own data — the pseudo-enum.
 */
export const sampleRows: Record<string, Record<string, unknown>[]> = {
  User: [
    // prettier-ignore
    {
      id: 1,
      tier: 'gold',
      active: true,
      email: 'ada@acme.io',
      age: 34,
      role: 'admin',
      createdAt: '2026-01-15T09:00:00.000Z',
      metadata: { theme: 'dark' },
      orders: [{ id: 11, total: 120.5, status: 'paid', placedAt: '2026-02-01T00:00:00.000Z' }],
      enrichments: [
        { key: 'nps', value: '9' },
        { key: 'persona', value: 'champion' },
      ],
    },
    {
      id: 2,
      tier: 'silver',
      active: true,
      email: 'bo@acme.io',
      age: 22,
      role: 'member',
      createdAt: '2026-03-20T14:30:00.000Z',
      metadata: { theme: 'light' },
      orders: [{ id: 12, total: 40, status: 'pending', placedAt: '2026-03-21T00:00:00.000Z' }],
      enrichments: [
        { key: 'nps', value: '3' },
        { key: 'persona', value: 'end-user' },
      ],
    },
    {
      id: 3,
      tier: 'silver',
      active: true,
      email: 'cy@acme.io',
      age: 41,
      role: 'member',
      createdAt: '2026-05-02T08:15:00.000Z',
      metadata: {},
      orders: [],
    }, // duplicate tier → distinct
    {
      id: 4,
      tier: 'bronze',
      active: false,
      email: 'di@acme.io',
      age: 29,
      role: 'guest',
      createdAt: '2026-06-10T18:45:00.000Z',
      metadata: {},
      orders: [],
    }, // dropped by where (active = true)
    {
      id: 5,
      tier: 'platinum',
      active: false,
      email: 'ed@acme.io',
      age: 55,
      role: 'guest',
      createdAt: '2026-06-28T11:00:00.000Z',
      metadata: {},
      orders: [],
    }, // dropped by where
  ],
  Account: [
    { id: 1, industry: 'tech' },
    { id: 2, industry: 'finance' },
    { id: 3, industry: 'health' },
    { id: 4, industry: 'tech' }, // duplicate → distinct
  ],
};

/** A cross-map lens: anchored at app.User with the bridge attached, so app + crm are both reachable. */
export const sampleLenses: Record<string, SavedLens> = {
  'app-users': { mapName: 'app', model: 'User', maps: ['app', 'crm'], bridges: sampleBridges },
};

/**
 * The pre-#1470 experience, rebuilt as a *presentation-only* Decoration over the
 * `app-users` lens. Nothing here changes what the engine runs — every entry emits
 * its real dotted path; this only renames what the picker offers and hoists other
 * sources up to the root. It reproduces the three regressions #1470 introduced:
 *
 *  1. **Other sources at the root** — Salesforce (`crm:Account.*`, reached across the
 *     bridge) is selectable directly, not buried behind a relation walk.
 *  2. **Customer-facing names** — raw column names become the labels admins knew.
 *  3. **EAV as one field** — `enrichments where key='nps'` reads as a single "NPS
 *     Score" field (with a `kind` override so it gets numeric operators), instead of
 *     a raw key/value array builder.
 *
 * NOTE: the labels/icons below are illustrative. At port time into the app, swap
 * them for the exact pre-#1470 display strings + source icons (Salesforce,
 * UserEvidence, Advocacy, Gong) so the copy matches what customers saw before.
 */
export const segmentDecoration: Decoration = {
  facets: [
    // Catch-all EAV facet: a Field selector picks the key; picking a curated key
    // (nps/persona) refines into the stricter facet below on reload.
    {
      path: 'enrichments',
      label: 'Custom Field',
      icon: '🧩',
      selectors: [{ field: 'key', label: 'Field', anyLabel: 'Any field' }],
    },
    // EAV enrichments collapsed to named fields — the marquee fix.
    {
      path: 'enrichments.value',
      where: { field: 'key', operator: 'equals', value: 'nps' },
      kind: 'Int',
      label: 'NPS Score',
      icon: '📈',
    },
    {
      path: 'enrichments.value',
      where: { field: 'key', operator: 'equals', value: 'persona' },
      label: 'Persona',
      icon: '🧭',
    },
    // Salesforce fields, hoisted to the root across the bridge (other sources reachable).
    { path: 'crm:Account.industry', label: 'Industry', icon: '💼' },
    { path: 'crm:Account.name', label: 'Account Name', icon: '💼' },
    { path: 'crm:Account.tier', label: 'Account Tier', icon: '💼' },
  ],
  // Per-model facets: applied natively at every Order surface, any depth.
  models: {
    Order: [{ path: 'status', label: 'Order Status', icon: '📦' }],
  },
  labels: {
    models: {
      'app:User': { label: 'Advocate', icon: '⭐' },
      'crm:Account': { label: 'Salesforce Account', icon: '💼' },
    },
    fields: {
      'User.tier': { label: 'Plan', icon: '⭐' },
      'User.email': { label: 'Email', icon: '⭐' },
      'User.role': { label: 'Role', icon: '⭐' },
      'User.active': { label: 'Active', icon: '⭐' },
      'User.createdAt': { label: 'Signup Date', icon: '⭐' },
      'User.enrichments': { label: 'Custom Fields (raw)' },
    },
    values: {
      'User.role': {
        admin: { label: 'Administrator' },
        member: { label: 'Member' },
        guest: { label: 'Guest' },
      },
    },
  },
};

/** Two narrowings: one off the lens, one chained off that narrowing — each only restricts further. */
export const sampleNarrowings: Record<string, SavedNarrowing> = {
  'vip-active': {
    parent: { kind: 'lens', name: 'app-users' },
    narrowing: {
      root: {
        picks: ['id', 'email', 'tier', 'role', 'active', 'metadata'],
        where: { all: [{ field: 'active', operator: 'equals', value: true }] },
        enumPicks: { role: ['admin', 'member'] },
        sources: { tier: { all: [{ field: 'active', operator: 'equals', value: true }] } },
      },
      mapDefaults: {
        crm: {
          models: {
            Account: {
              picks: ['id', 'name', 'industry', 'tier'],
              sources: { industry: { all: [] } },
            },
          },
        },
      },
    },
  },
  'admins-only': {
    parent: { kind: 'narrowing', name: 'vip-active' },
    narrowing: { root: { enumPicks: { role: ['admin'] } } },
  },
};

/**
 * A rebac schema spanning two resources so a `rel` walk has somewhere to land:
 * `app:User.read` walks the bridge to `crm:Account` and delegates to its `read`. The action
 * picker on that hop is populated from `crm:Account`'s own defined actions.
 */
export const samplePermissions: Workspace['permissions'] = {
  'app:User': {
    actions: {
      own: null, // terminal deny
      manage: 'own', // delegate
      read: {
        any: [
          { self: 'id' },
          { rule: { all: [{ field: 'active', operator: 'equals', value: true }] } },
          'manage',
          { rel: 'crm:Account', action: 'read' }, // walk the bridge → use Account's read
        ],
      },
    },
  },
  'crm:Account': {
    actions: {
      own: { self: 'ownerEmail' },
      read: 'own',
    },
  },
  'app:Order': {
    actions: {
      own: { self: 'userId' },
      manage: 'own',
    },
  },
};

/**
 * A lifecycle transition on app:Order: pending → paid, guarded by a positive total. The `from`
 * side carries a `permission` that delegates to the `manage` action defined on `app:Order` in the
 * permission schema — the transition's authz is aware of the permissions object.
 */
export const sampleTransitions: Workspace['transitions'] = {
  'app:Order': {
    capturePayment: {
      paths: [
        {
          from: {
            predicate: {
              all: [
                { field: 'status', operator: 'equals', value: 'pending' },
                { field: 'total', operator: 'greaterThan', value: 0 },
              ],
            },
            permission: 'manage',
          },
          to: { predicate: { all: [{ field: 'status', operator: 'equals', value: 'paid' }] } },
        },
      ],
    },
  },
};

export const defaultWorkspace = (): Workspace => ({
  ...emptyWorkspace(),
  maps: sampleMaps,
  bridges: sampleBridges,
  lenses: sampleLenses,
  narrowings: sampleNarrowings,
  decorations: { segment: segmentDecoration },
  permissions: samplePermissions,
  transitions: sampleTransitions,
});
