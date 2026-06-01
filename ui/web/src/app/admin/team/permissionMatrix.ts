// Single source of truth for the permission matrix rendered in TeamManager
// and RolesManager. Adding a new module or action here updates both editors.

export const PERMISSION_MATRIX: Array<{
  key: string;
  label: string;
  actions: Array<{ key: string; label: string }>;
  group?: string;            // optional visual grouping in the editor
}> = [
  { key: 'inventory', label: 'Inventory',     group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'set_live', label: 'Set Live' }] },
  { key: 'pricing',   label: 'Pricing',       group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'run', label: 'Run' }, { key: 'approve', label: 'Approve' }] },
  { key: 'customers', label: 'Customers',     group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'approve', label: 'Approve KYC' }] },
  { key: 'enquiries', label: 'Enquiries',     group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'approve', label: 'Approve' }] },
  { key: 'sales',     label: 'Sales/Orders',  group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }] },
  { key: 'cash',      label: 'Cash Payments', group: 'Core',  actions: [{ key: 'view', label: 'View' }, { key: 'approve', label: 'Approve' }] },

  // ── AI tools — each gets View (nav visibility) and Run (execute). Hide the
  // tool entirely by unchecking both. Owner can grant any combination per user.
  { key: 'ai_briefing',    label: '🌅 Morning Briefing',   group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_aging',       label: '⏳ Aging Triage',        group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_demand',      label: '📈 Demand Forecast',    group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_quote',       label: '🤝 Quote Negotiation',  group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_memo',        label: '📝 Memo Approval',      group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_clv',         label: '👑 CLV Analysis',       group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_threads',     label: '🧵 Negotiation Threads', group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },
  { key: 'ai_collections', label: '💰 Collections',        group: 'AI Tools', actions: [{ key: 'view', label: 'View' }, { key: 'run', label: 'Run' }] },

  { key: 'system',    label: 'System',     group: 'Admin', actions: [{ key: 'view', label: 'View' }, { key: 'manage', label: 'Manage' }] },
  { key: 'templates', label: 'Templates',  group: 'Admin', actions: [{ key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }] },
  { key: 'team',      label: 'Team',       group: 'Admin', actions: [{ key: 'view', label: 'View' }, { key: 'manage', label: 'Manage' }] },
];
