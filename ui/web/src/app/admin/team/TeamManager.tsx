'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';

type LegacyRole = 'OWNER' | 'SALES' | 'ACCOUNTS';

type AdminRow = {
  id: string; email: string; name: string;
  role: LegacyRole; isActive: boolean;
  roleId: string | null;
  roleName: string;
  permissions: Record<string, Record<string, boolean>>;
  createdAt: string;
  self: boolean;
};

type RoleRow = {
  id: string; name: string; slug: string;
  isOwnerLike: boolean; isSystem: boolean;
  permissions: Record<string, Record<string, boolean>>;
  admins: number;
};

// Override matrix — what an Owner can OVERRIDE on top of a role's defaults
// for an individual admin. Shared with RolesManager via permissionMatrix.ts
// so any new module / action shows up in both editors automatically.
import { PERMISSION_MATRIX as MATRIX } from './permissionMatrix';

export function TeamManager({ admins, roles }: { admins: AdminRow[]; roles: RoleRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setCreating(true); setError(null); }} className="btn-primary">
          ＋ Add team member
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {admins.map(a => (
              <tr key={a.id} className="border-t border-brand-100">
                <td className="px-3 py-2">{a.name}{a.self && <span className="ml-2 text-xs text-brand-700">(you)</span>}</td>
                <td className="px-3 py-2 text-xs font-mono">{a.email}</td>
                <td className="px-3 py-2"><span className="text-xs px-2 py-0.5 rounded bg-brand-50 text-brand-700">{a.roleName}</span></td>
                <td className="px-3 py-2">
                  {a.isActive
                    ? <span className="text-emerald-700 text-xs">● Active</span>
                    : <span className="text-rose-700 text-xs">● Disabled</span>}
                </td>
                <td className="px-3 py-2 text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  {!a.self && (
                    <button onClick={() => { setEditingId(a.id); setError(null); }}
                            className="text-xs text-gold-600 hover:underline">
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateMemberModal
          roles={roles}
          busy={busy} error={error}
          onCancel={() => { setCreating(false); setError(null); }}
          onSubmit={async (data) => {
            setBusy(true); setError(null);
            const res = await fetch('/api/admin/team', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(data),
            });
            const body = await res.json();
            setBusy(false);
            if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {editingId && (
        <EditMemberModal
          admin={admins.find(a => a.id === editingId)!}
          roles={roles}
          busy={busy} error={error}
          onCancel={() => { setEditingId(null); setError(null); }}
          onSave={async (data) => {
            setBusy(true); setError(null);
            const res = await fetch(`/api/admin/team/${editingId}`, {
              method: 'PATCH', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(data),
            });
            const body = await res.json();
            setBusy(false);
            if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
            setEditingId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateMemberModal({
  roles, busy, error, onCancel, onSubmit,
}: {
  roles: RoleRow[]; busy: boolean; error: string | null;
  onCancel: () => void;
  onSubmit: (data: { email: string; name: string; password: string; roleId: string }) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(roles.find(r => r.slug === 'sales')?.id ?? roles[0]?.id ?? '');

  const selectedRole = roles.find(r => r.id === roleId);

  return (
    <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md space-y-4">
        <h2 className="font-serif text-xl">Add team member</h2>
        <div className="grid grid-cols-1 gap-3 text-sm">
          <Field label="Name"><input className="input" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
          <Field label="Temporary password (≥ 8 chars)">
            <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className="input" value={roleId} onChange={e => setRoleId(e.target.value)}>
              {roles.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.isOwnerLike ? ' (full access)' : r.isSystem ? ' (system)' : ''}
                </option>
              ))}
            </select>
            {selectedRole?.isOwnerLike && (
              <p className="text-xs text-amber-700 mt-1">⚠ This role grants full access. Use sparingly.</p>
            )}
          </Field>
        </div>
        <p className="text-xs text-brand-700">
          The new member inherits all permissions from the selected role. You can
          add per-admin overrides after creation.
        </p>
        {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={busy} className="btn-outline">Cancel</button>
          <button onClick={() => onSubmit({ email, name, password, roleId })}
                  disabled={busy || !email || !name || password.length < 8 || !roleId}
                  className="btn-primary">
            {busy ? 'Creating…' : 'Create member'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditMemberModal({
  admin, roles, busy, error, onCancel, onSave,
}: {
  admin: AdminRow; roles: RoleRow[]; busy: boolean; error: string | null;
  onCancel: () => void;
  onSave: (data: { roleId?: string; permissions?: any; isActive?: boolean }) => void;
}) {
  const [roleId, setRoleId] = useState(admin.roleId ?? '');
  const [perms, setPerms] = useState<Record<string, Record<string, boolean>>>(admin.permissions ?? {});
  const [isActive, setIsActive] = useState(admin.isActive);

  const selectedRole = roles.find(r => r.id === roleId);

  function toggleOverride(module: string, action: string) {
    setPerms(prev => {
      const cur = prev[module] ?? {};
      return { ...prev, [module]: { ...cur, [action]: !cur[action] } };
    });
  }

  function clearOverrides() {
    setPerms({});
  }

  // Effective (visual only): what the admin will actually be able to do.
  const effective: Record<string, Record<string, boolean>> = {};
  const base = selectedRole?.permissions ?? {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(perms)])) {
    effective[key] = { ...(base[key] ?? {}), ...(perms[key] ?? {}) };
  }

  return (
    <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-3xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="font-serif text-xl">Edit — {admin.name}</h2>
          <p className="text-xs text-brand-700 font-mono">{admin.email}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Role</div>
            <select className="input" value={roleId} onChange={e => setRoleId(e.target.value)}>
              {roles.map(r => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.isOwnerLike ? ' (full access)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-brand-700 mb-1">Status</div>
            <button onClick={() => setIsActive(v => !v)}
                    className={`text-xs px-3 py-2 rounded border ${
                      isActive ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                               : 'border-rose-300 bg-rose-50 text-rose-800'
                    }`}>
              {isActive ? '● Active — click to disable' : '● Disabled — click to reactivate'}
            </button>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-end mb-1">
            <div className="text-xs uppercase tracking-widest text-brand-700">Per-admin permission overrides</div>
            {Object.keys(perms).length > 0 && (
              <button onClick={clearOverrides} className="text-xs text-brand-700 hover:text-gold-600 underline">
                Clear all overrides
              </button>
            )}
          </div>
          <p className="text-xs text-brand-700/70 mb-2">
            Checkboxes here OVERRIDE the role's defaults for this user only. Uncheck a column to keep using the role's value (shown in green if effective).
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-brand-700 text-xs uppercase tracking-widest border-b border-brand-100">
                  <th className="py-2 px-2">Module</th>
                  <th className="py-2 px-2">Override</th>
                  <th className="py-2 px-2">Effective</th>
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((m, idx) => {
                  // Render a faint group header when the group flips between rows.
                  const prevGroup = idx > 0 ? MATRIX[idx - 1].group : null;
                  const showGroupHeader = m.group && m.group !== prevGroup;
                  return (
                  <Fragment key={m.key}>
                  {showGroupHeader && (
                    <tr>
                      <td colSpan={3} className="pt-3 pb-1 text-[10px] uppercase tracking-widest text-brand-700/60 px-2">
                        {m.group}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-brand-100/60 align-top">
                    <td className="py-2 px-2 font-medium">{m.label}</td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-3">
                        {m.actions.map(a => {
                          const on = Boolean(perms[m.key]?.[a.key]);
                          return (
                            <label key={a.key} className="flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={on} onChange={() => toggleOverride(m.key, a.key)} />
                              <span className="text-sm">{a.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-xs">
                      {m.actions.map(a => {
                        const fromRole = Boolean(base[m.key]?.[a.key]);
                        const fromOverride = perms[m.key] && a.key in (perms[m.key] ?? {});
                        const eff = Boolean(effective[m.key]?.[a.key]);
                        return (
                          <span key={a.key}
                                className={`inline-block mr-2 ${
                                  eff ? (fromOverride ? 'text-gold-700' : 'text-emerald-700') : 'text-brand-700/40 line-through'
                                }`}>
                            {a.label}
                          </span>
                        );
                      })}
                    </td>
                  </tr>
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selectedRole?.isOwnerLike && (
          <div className="text-xs text-amber-800 bg-amber-50/60 p-2 rounded">
            Owner-like roles always have full access regardless of overrides.
          </div>
        )}

        {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={busy} className="btn-outline">Cancel</button>
          <button onClick={() => onSave({ roleId, permissions: perms, isActive })}
                  disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-brand-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
