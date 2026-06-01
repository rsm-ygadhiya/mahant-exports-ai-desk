import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const patchSchema = z.object({
  roleId: z.string().optional(),
  permissions: z.record(z.record(z.boolean())).optional(),
  isActive: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'nothing to update' });

/** PATCH /api/admin/team/:id — update role assignment, per-admin overrides, or active state. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  // Can't disable / demote yourself by accident.
  if (params.id === me.id) {
    return NextResponse.json({ error: "Can't edit your own account here." }, { status: 400 });
  }

  const body = patchSchema.parse(await req.json());
  const before = await prisma.admin.findUnique({ where: { id: params.id }, include: { customRole: true } });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: any = {};
  let nextRole = before.customRole;
  if (body.roleId && body.roleId !== before.roleId) {
    nextRole = await prisma.role.findUnique({ where: { id: body.roleId } });
    if (!nextRole) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });
    data.roleId = nextRole.id;
    // Keep legacy enum in sync for backward compat with hasPermission()'s OWNER shortcut.
    data.role = nextRole.slug === 'owner' ? 'OWNER'
              : nextRole.slug === 'sales' ? 'SALES'
              : nextRole.slug === 'accounts' ? 'ACCOUNTS'
              : 'SALES';
  }
  if (body.permissions) data.permissions = body.permissions;
  if (body.isActive != null) data.isActive = body.isActive;

  const updated = await prisma.admin.update({ where: { id: params.id }, data });

  if (body.roleId && body.roleId !== before.roleId) {
    await audit({
      actorId: me.id, action: 'admin.role_change', targetType: 'Admin', targetId: updated.id,
      oldValue: { roleId: before.roleId, role: before.role },
      newValue: { roleId: updated.roleId, role: updated.role },
    });
  }
  if (body.permissions) {
    await audit({
      actorId: me.id, action: 'permission.replace', targetType: 'Admin', targetId: updated.id,
      oldValue: before.permissions as any, newValue: body.permissions as any,
    });
  }
  if (body.isActive != null && body.isActive !== before.isActive) {
    await audit({
      actorId: me.id,
      action: body.isActive ? 'admin.reactivate' : 'admin.deactivate',
      targetType: 'Admin', targetId: updated.id,
    });
  }

  return NextResponse.json({
    id: updated.id, roleId: updated.roleId, isActive: updated.isActive,
    permissions: updated.permissions,
  });
}
