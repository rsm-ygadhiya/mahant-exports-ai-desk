import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  roleId: z.string().min(1),
});

/** POST /api/admin/team — create a new team member. team.manage permission required. */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;
  const me = guard.admin;

  const body = createSchema.parse(await req.json());

  const role = await prisma.role.findUnique({ where: { id: body.roleId } });
  if (!role) return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });

  const dupe = await prisma.admin.findUnique({ where: { email: body.email } });
  if (dupe) return NextResponse.json({ error: 'Email already in use.' }, { status: 409 });

  const passwordHash = await bcrypt.hash(body.password, 10);

  // Backward compat: also set the legacy enum field if the role slug matches.
  const legacyRole = role.slug === 'owner' ? 'OWNER'
                   : role.slug === 'sales' ? 'SALES'
                   : role.slug === 'accounts' ? 'ACCOUNTS'
                   : 'SALES'; // safe default for custom roles

  const newAdmin = await prisma.admin.create({
    data: {
      email: body.email,
      name: body.name,
      passwordHash,
      role: legacyRole,
      roleId: role.id,
      permissions: {} as any, // no per-admin overrides at create time
    },
  });

  await audit({
    actorId: me.id,
    action: 'admin.create',
    targetType: 'Admin',
    targetId: newAdmin.id,
    newValue: { email: newAdmin.email, role: role.name },
  });

  return NextResponse.json({
    id: newAdmin.id, email: newAdmin.email, name: newAdmin.name, roleId: role.id,
  });
}
