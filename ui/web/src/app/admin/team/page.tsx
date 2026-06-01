import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { TeamManager } from './TeamManager';
import { RolesManager } from './RolesManager';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!hasPermission(me as any, 'team', 'manage')) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-serif text-2xl">Restricted</h1>
        <p className="text-sm text-brand-700 mt-2">
          Only roles with team-management permission can access this page.
        </p>
      </div>
    );
  }

  const [admins, roles, recentAudit] = await Promise.all([
    prisma.admin.findMany({
      orderBy: [{ createdAt: 'asc' }],
      include: { customRole: true },
    }),
    prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { admins: true } } },
    }),
    prisma.auditLog.findMany({
      where: { action: { in: ['permission.replace', 'permission.grant', 'permission.revoke', 'admin.role_change', 'admin.create', 'admin.deactivate', 'admin.reactivate'] } },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);

  const safeAdmins = admins.map(a => ({
    id: a.id, email: a.email, name: a.name,
    role: a.role, isActive: a.isActive,
    roleId: a.roleId,
    roleName: a.customRole?.name ?? a.role,
    permissions: a.permissions as any,
    createdAt: a.createdAt.toISOString(),
    self: a.id === me.id,
  }));

  const safeRoles = roles.map(r => ({
    id: r.id, name: r.name, slug: r.slug,
    isOwnerLike: r.isOwnerLike, isSystem: r.isSystem,
    permissions: r.permissions as any,
    admins: r._count.admins,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Team &amp; Permissions</h1>
        <p className="text-sm text-brand-700 mt-1">
          Manage admin accounts and roles. Create custom roles with whatever permission
          combination you need. All changes are audit-logged.
        </p>
      </div>

      <RolesManager roles={safeRoles} />

      <div>
        <h2 className="font-serif text-xl mb-3">Admin accounts</h2>
        <TeamManager admins={safeAdmins} roles={safeRoles} />
      </div>

      <div>
        <h2 className="font-serif text-xl mb-3">Recent permission changes</h2>
        {recentAudit.length === 0 ? (
          <div className="card p-6 text-sm text-brand-700 text-center">No team changes yet.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Target</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map(e => (
                  <tr key={e.id} className="border-t border-brand-100">
                    <td className="px-3 py-2 text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{e.actor.name} <span className="text-brand-700 text-xs">({e.actor.email})</span></td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.targetType} {e.targetId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
