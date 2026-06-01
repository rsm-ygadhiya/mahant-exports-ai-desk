// Granular per-module permissions for the admin panel.
//
// Stored on `Admin.permissions` as JSON. Each admin gets a default set based
// on their role (Owner / Sales / Accounts) at creation time. The Owner can
// then override individual permissions per user via /admin/team.
//
// Spec reference: admin_panel_spec.md §1.4 and §11.

import type { AdminRole } from '@prisma/client';

/** Modules in the admin panel. Each module has its own permission flags. */
export type ModuleKey =
  | 'inventory'   // stock, memo, sold, upload
  | 'pricing'     // pricing runs, Rap, approvals
  | 'customers'   // customer list, KYC, approval
  | 'enquiries'   // enquiry list, approve/cancel
  | 'sales'       // orders + payments
  | 'cash'        // cash payment approval (Accounts-only by default)
  | 'system'      // server view, backups
  | 'templates'   // message templates editor
  | 'team'        // user account management (Owner-only by default)
  // ── AI / insight tools — each one is its own permission unit so the Owner
  // can grant view/run access (or hide entirely) per admin via /admin/team.
  | 'ai_briefing'
  | 'ai_aging'
  | 'ai_demand'
  | 'ai_quote'
  | 'ai_memo'
  | 'ai_clv'
  | 'ai_threads'
  | 'ai_collections'
  | 'ai_ask';        // RAG Q&A over desk state (Claude via TritonAI)

/** Actions are checked against module permissions. Not every action applies to every module. */
export type Action = 'view' | 'edit' | 'approve' | 'run' | 'set_live' | 'manage';

export type Permissions = {
  [K in ModuleKey]?: Partial<Record<Action, boolean>>;
};

/** All AI tools default to view+run for whoever has them. */
const AI_TOOL_FULL = { view: true, run: true } as const;

const FULL = {
  inventory: { view: true, edit: true, set_live: true },
  pricing:   { view: true, edit: true, run: true, approve: true },
  customers: { view: true, edit: true, approve: true },
  enquiries: { view: true, edit: true, approve: true },
  sales:     { view: true, edit: true },
  cash:      { approve: true, view: true },
  system:    { view: true, manage: true },
  templates: { view: true, edit: true },
  team:      { view: true, edit: true, manage: true },
  ai_briefing:    AI_TOOL_FULL,
  ai_aging:       AI_TOOL_FULL,
  ai_demand:      AI_TOOL_FULL,
  ai_quote:       AI_TOOL_FULL,
  ai_memo:        AI_TOOL_FULL,
  ai_clv:         AI_TOOL_FULL,
  ai_threads:     AI_TOOL_FULL,
  ai_collections: AI_TOOL_FULL,
  ai_ask:         AI_TOOL_FULL,
} as const satisfies Permissions;

/** Defaults applied at create time. Owner overrides per user afterwards. */
export const DEFAULT_PERMISSIONS: Record<AdminRole, Permissions> = {
  OWNER: FULL,

  SALES: {
    inventory: { view: true, edit: true, set_live: true },
    pricing:   { view: true, edit: true, run: true, approve: true },
    customers: { view: true, edit: true, approve: true },
    enquiries: { view: true, edit: true, approve: true },
    sales:     { view: true, edit: true },
    // Sales can record cash payments but NOT confirm them — that's Accounts.
    cash:      { view: true },
    templates: { view: true },
    // AI tools: Sales gets operational insights (not the owner-level briefing).
    ai_aging:       AI_TOOL_FULL,
    ai_demand:      AI_TOOL_FULL,
    ai_quote:       AI_TOOL_FULL,
    ai_memo:        AI_TOOL_FULL,
    ai_threads:     AI_TOOL_FULL,
    ai_ask:         AI_TOOL_FULL,
  },

  ACCOUNTS: {
    inventory: { view: true },
    pricing:   { view: true },
    customers: { view: true },
    enquiries: { view: true },
    sales:     { view: true, edit: true },
    // Only Accounts can confirm cash payments.
    cash:      { view: true, approve: true },
    templates: { view: true },
    // AI tools: Accounts gets the financial ones.
    ai_clv:         AI_TOOL_FULL,
    ai_collections: AI_TOOL_FULL,
  },
};

/**
 * The minimal shape needed for permission checks. Pass either:
 *   - a full Admin row WITH `customRole` included (preferred)
 *   - a plain object with at least `role` (the legacy enum) and `permissions`
 *
 * Effective permissions = (role.permissions) merged with (admin.permissions).
 * Admin-level entries win on every key they set.
 */
type AdminLike = {
  role: AdminRole;
  permissions: any;
  customRole?: { isOwnerLike: boolean; permissions: any } | null;
};

function resolvePermissions(admin: AdminLike): Permissions {
  const base = (admin.customRole?.permissions ?? {}) as Permissions;
  const override = (admin.permissions ?? {}) as Permissions;
  return mergePermissions(base, override);
}

/**
 * Check if an admin has a specific permission.
 *
 * Owner-like roles (the legacy OWNER enum, OR any Role row with isOwnerLike=true)
 * always get a hard yes, so we can't accidentally lock the owner out of their
 * own panel by saving an empty permissions object.
 */
export function hasPermission(
  admin: AdminLike,
  module: ModuleKey,
  action: Action,
): boolean {
  if (admin.role === 'OWNER') return true;
  if (admin.customRole?.isOwnerLike) return true;
  const effective = resolvePermissions(admin);
  return Boolean(effective[module]?.[action]);
}

/** Helper for "can the user see this nav item at all?" */
export function canViewModule(admin: AdminLike, module: ModuleKey): boolean {
  return hasPermission(admin, module, 'view');
}

/** True only for legacy OWNER role or a custom role flagged isOwnerLike.
 *  Use for owner-restricted items like the Morning Briefing. */
export function isOwner(admin: AdminLike): boolean {
  if (admin.role === 'OWNER') return true;
  if (admin.customRole?.isOwnerLike) return true;
  return false;
}

/** Merge two permission sets, with `override` winning where it has a value. */
export function mergePermissions(base: Permissions, override: Permissions): Permissions {
  const out: Permissions = {};
  const keys = new Set<ModuleKey>([
    ...(Object.keys(base) as ModuleKey[]),
    ...(Object.keys(override) as ModuleKey[]),
  ]);
  for (const k of keys) {
    out[k] = { ...(base[k] ?? {}), ...(override[k] ?? {}) };
  }
  return out;
}

/** Nav configuration: each entry says which module + action governs visibility.
 *  `action` defaults to 'view' when omitted.
 *  `ownerOnly` (when true) restricts the item to Owner / Owner-like roles even
 *  if they'd pass the regular permission check — used for high-level views like
 *  the Morning Briefing that should never leak to Sales / Accounts. */
export const NAV_ITEMS: Array<{ href: string; label: string; module: ModuleKey; action?: Action; ownerOnly?: boolean }> = [
  { href: '/admin',              label: 'Dashboard',         module: 'inventory' }, // dashboard requires general access
  { href: '/admin/diamonds',     label: 'Stock',             module: 'inventory' },
  { href: '/admin/pending-stock',label: '🆕 Pending Stock',  module: 'inventory' },
  { href: '/admin/memo',         label: 'On Memo',           module: 'inventory' },
  { href: '/admin/sales',        label: '🧾 Sales & Orders',  module: 'sales' },
  { href: '/admin/sold',         label: 'Sold stones',       module: 'sales' },
  { href: '/admin/pricing',      label: '💎 Pricing',         module: 'pricing' },
  { href: '/admin/upload',       label: 'Excel Upload',      module: 'inventory' },
  { href: '/admin/customers',    label: 'Customers',         module: 'customers' },
  { href: '/admin/enquiries',    label: 'Enquiries',         module: 'enquiries' },
  // AI tools — each gated by its OWN module so the Owner can grant/revoke
  // view (nav visibility) or run (execution) per admin via /admin/team.
  { href: '/admin/ai/briefing',    label: '🌅 Morning Briefing',   module: 'ai_briefing' },
  { href: '/admin/ai/aging',       label: '⏳ Aging Triage',        module: 'ai_aging' },
  { href: '/admin/ai/memo',        label: '📝 Memo Approval',      module: 'ai_memo' },
  { href: '/admin/ai/collections', label: '💰 Collections',        module: 'ai_collections' },
  { href: '/admin/scintilla',      label: '✦ Scintilla',           module: 'ai_briefing' },
  { href: '/admin/evals',          label: '🧪 Evals',              module: 'ai_briefing' },
  { href: '/admin/opportunities',  label: '🌐 Opportunities',      module: 'ai_briefing' },
  { href: '/admin/notifications',label: 'Notifications',     module: 'templates' },
  // Templates editor — gated by edit, not view (Owner-only by default).
  { href: '/admin/templates',    label: '✉ Templates',        module: 'templates', action: 'edit' },
  { href: '/admin/team',         label: '⚙ Team',            module: 'team' },
  // Audit log — full visibility is Owner-only (each non-Owner sees their actions on entity pages).
  { href: '/admin/audit',        label: '📜 Audit log',       module: 'team', ownerOnly: true },
];
