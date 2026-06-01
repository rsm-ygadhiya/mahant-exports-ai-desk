import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/audit';

const schema = z.object({
  subject: z.string().optional().nullable(),
  body: z.string().min(1).optional(),
  channel: z.enum(['SMS', 'EMAIL', 'BOTH']).optional(),
});

/** PATCH /api/admin/templates/:id — edit a message template. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req, 'templates', 'edit');
  if (!guard.ok) return guard.response;
  const admin = guard.admin;

  const body = schema.parse(await req.json());
  const before = await prisma.messageTemplate.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const updated = await prisma.messageTemplate.update({
    where: { id: params.id },
    data: {
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
      ...(body.body ? { body: body.body } : {}),
      ...(body.channel ? { channel: body.channel } : {}),
      updatedBy: admin.id,
    },
  });

  await audit({
    actorId: admin.id, action: 'permission.replace', // generic 'config changed' bucket
    targetType: 'MessageTemplate', targetId: updated.id,
    oldValue: { subject: before.subject, body: before.body, channel: before.channel },
    newValue: { subject: updated.subject, body: updated.body, channel: updated.channel },
    notes: `template.${before.key}`,
  });

  return NextResponse.json({ template: updated });
}
