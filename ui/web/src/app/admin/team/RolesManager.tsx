'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PERMISSION_MATRIX as MATRIX } from './permissionMatrix';

type Role = {
  id: string; name: string; slug: string;
  isOwnerLike: boolean; isSystem: boolean;
  permissions: Record<string, Record<string, boolean>>;
  admins: number;
};

export function RolesManager({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteRole(r: Role) {
    if (r.isSystem) return;
    if (r.admins > 0) { alert(`Reassign ${r.admins} admin(s) first.`); return; }
    if (!confirm(`Delete role "${r.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/admin/roles/${r.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { const d = await res.json(); alert(d.error); return; }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="font-serif text-xl">Roles</h2>
        <button onClick={() => { setCreating(true); setError(null); }} className="btn-primary">
          ＋ New role
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Admins using</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(r => (
              <tr key={r.id} className="border-t border-brand-100">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-brand-700 font-mono">{r.slug}</div>
                </td>
                <td className="px-3 py-2">
                  {r.isOwnerLike
                    ? <span className="text-xs px-2 py-0.5 rounded bg-gold-500/20 text-gold-700">Owner-like</span>
                    : r.isSystem
                      ? <span className="text-xs px-2 py-0.5 rounded bg-brand-50 text-brand-700">System</span>
                      : <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">Custom</span>}
                </td>
                <td className="px-3 py-2 text-right">{r.admins}</td>
                <td className="px-3 py-2 text-right space-x-3 whitespace-nowrap">
                  <button onClick={() => { setEditing(r); setError(null); }}
                          disabled={r.isOwnerLike}
                          className="text-xs text-gold-600 hover:underline disabled:opacity-30">
                    Edit permissions
                  </button>
                  {!r.isSystem && (
                    <button onClick={() => deleteRole(r)} disabled={busy || r.admins > 0}
                            className="text-xs text-rose-700 hover:underline disabled:opacity-30">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <RoleEditorModal
          mode="create"
          initial={{ name: '', permissions: {} }}
          busy={busy} error={error}
          onCancel={() => { setCreating(false); setError(null); }}
          onSave={async (data) => {
            setBusy(true); setError(null);
            const res = await fetch('/api/admin/roles', {
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

      {editing && (
        <RoleEditorModal
          mode="edit"
          initial={editing}
          busy={busy} error={error}
          onCancel={() => { setEditing(null); setError(null); }}
          onSave={async (data) => {
            setBusy(true); setError(null);
            const payload: any = { permissions: data.permissions };
            if (!editing.isSystem) payload.name = data.name;
            const res = await fetch(`/api/admin/roles/${editing.id}`, {
              method: 'PATCH', headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const body = await res.json();
            setBusy(false);
            if (!res.ok) { setError(body.error ?? `Failed (${res.status})`); return; }
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RoleEditorModal({
  mode, initial, busy, error, onCancel, onSave,
}: {
  mode: 'create' | 'edit';
  initial: { name: string; permissions: Record<string, Record<string, boolean>>; isSystem?: boolean };
  busy: boolean; error: string | null;
  onCancel: () => void;
  onSave: (data: { name: string; permissions: Record<string, Record<string, boolean>> }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [perms, setPerms] = useState<Record<string, Record<string, boolean>>>(initial.permissions ?? {});

  function toggle(module: string, action: string) {
    setPerms(prev => ({
      ...prev,
      [module]: { ...(prev[module] ?? {}), [action]: !prev[module]?.[action] },
    }));
  }

  return (
    <div className="fixed inset-0 bg-brand-900/60 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-3xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="font-serif text-xl">{mode === 'create' ? 'Create new role' : `Edit — ${initial.name}`}</h2>
          {initial.isSystem && (
            <p className="text-xs text-brand-700 mt-1">
              This is a system role. You can adjust its permissions but cannot rename or delete it.
            </p>
          )}
        </div>

        {!initial.isSystem && (
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Role name</span>
            <input className="input mt-1" value={name} onChange={e => setName(e.target.value)}
                   placeholder="e.g. Sales Manager, Junior Sales, Bookkeeper" />
          </label>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-brand-700 text-xs uppercase tracking-widest border-b border-brand-100">
                <th className="py-2 px-2">Module</th>
                <th className="py-2 px-2">Permissions</th>
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((m, idx) => {
                const prevGroup = idx > 0 ? MATRIX[idx - 1].group : null;
                const showGroupHeader = m.group && m.group !== prevGroup;
                return (
                <Fragment key={m.key}>
                  {showGroupHeader && (
                    <tr>
                      <td colSpan={2} className="pt-3 pb-1 text-[10px] uppercase tracking-widest text-brand-700/60 px-2">
                        {m.group}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-brand-100/60">
                    <td className="py-2 px-2 font-medium">{m.label}</td>
                    <td className="py-2 px-2">
                      <div className="flex flex-wrap gap-3">
                        {m.actions.map(a => {
                          const on = Boolean(perms[m.key]?.[a.key]);
                          return (
                            <label key={a.key} className="flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={on} onChange={() => toggle(m.key, a.key)} />
                              <span className="text-sm">{a.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded">{error}</div>}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={busy} className="btn-outline">Cancel</button>
          <button onClick={() => onSave({ name, permissions: perms })}
                  disabled={busy || (mode === 'create' && !name.trim())}
                  className="btn-primary">
            {busy ? 'Saving…' : mode === 'create' ? 'Create role' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
