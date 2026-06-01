import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const createSchema = z.object({
  name: z.string().min(1).max(60),
  permissions: z.record(z.record(z.boolean())).default({}),
});

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'role';
}

/** GET — list all roles (system + custom). Owner-only via team.manage. */
export async function GET(req: Request) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;
  const roles = await prisma.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { admins: true } } },
  });
  return NextResponse.json({ roles });
}

/** POST — create a new custom role. Owner-only. */
export async function POST(req: Request) {
  const guard = await requireAdmin(req, 'team', 'manage');
  if (!guard.ok) return guard.response;
  const body = createSchema.parse(await req.json());

  const baseSlug = slugify(body.name);
  let slug = baseSlug;
  let n = 2;
  // Pick a unique slug if there's a collision.
  while (await prisma.role.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${n++}`;
  }

  const role = await prisma.role.create({
    data: {
      name: body.name,
      slug,
      isOwnerLike: false,
      isSystem: false,
      permissions: body.permissions as any,
    },
  });

  await audit({
    actorId: guard.admin.id,
    action: 'permission.grant',
    targetType: 'Role',
    targetId: role.id,
    newValue: { name: role.name, permissions: role.permissions },
    notes: 'role.create',
  });

  return NextResponse.json({ role });
}
