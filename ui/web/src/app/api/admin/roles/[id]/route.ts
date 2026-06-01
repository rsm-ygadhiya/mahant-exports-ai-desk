import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  permissions: z.record(z.record(z.boolean())).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'nothing to update' });

/** PATCH — rename or change permissions for a role. System roles can have
 *  permissions tweaked but cannot be renamed. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;

  const role = await prisma.role.findUnique({ where: { id: params.id } });
  if (!role) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = patchSchema.parse(await req.json());
  const data: any = {};

  if (body.name) {
    if (role.isSystem) {
      return NextResponse.json({ error: 'System roles cannot be renamed.' }, { status: 400 });
    }
    data.name = body.name;
  }
  if (body.permissions) {
    if (role.isOwnerLike) {
      return NextResponse.json(
        { error: 'Owner permissions are hard-coded to full access — editing has no effect.' },
        { status: 400 },
      );
    }
    data.permissions = body.permissions;
  }

  const updated = await prisma.role.update({ where: { id: params.id }, data });

  await audit({
    actorId: guard.admin.id,
    action: 'permission.replace',
    targetType: 'Role',
    targetId: role.id,
    oldValue: { name: role.name, permissions: role.permissions },
    newValue: { name: updated.name, permissions: updated.permissions },
  });

  return NextResponse.json({ role: updated });
}

/** DELETE — drop a custom role. System roles can't be deleted; admins using
 *  the role are unassigned (their FK is set to NULL by ON DELETE SET NULL). */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;

  const role = await prisma.role.findUnique({
    where: { id: params.id },
    include: { _count: { select: { admins: true } } },
  });
  if (!role) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (role.isSystem) {
    return NextResponse.json({ error: 'System roles cannot be deleted.' }, { status: 400 });
  }
  if (role._count.admins > 0) {
    return NextResponse.json(
      { error: `Reassign ${role._count.admins} admin(s) first before deleting this role.` },
      { status: 409 },
    );
  }

  await prisma.role.delete({ where: { id: params.id } });
  await audit({
    actorId: guard.admin.id,
    action: 'permission.revoke',
    targetType: 'Role',
    targetId: role.id,
    oldValue: { name: role.name, permissions: role.permissions },
    notes: 'role.delete',
  });

  return NextResponse.json({ ok: true });
}
