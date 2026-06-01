import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/adminGuard';

export async function POST(req: Request) {
  // Push notifications are template/messaging — gated by templates.edit.
  const guard = await requireAdmin(req, 'templates', 'edit');
  if (!guard.ok) return guard.response;

  const { title, body, audience } = z.object({
    title: z.string().min(1),
    body: z.string().min(1),
    audience: z.enum(['all', 'approved']).default('approved'),
  }).parse(await req.json());

  const note = await prisma.notification.create({ data: { title, body, audience } });

  // Production: pull push tokens, batch via FCM, then update sentAt.
  // Left as a marked integration point so wiring is obvious.
  if (process.env.FCM_SERVER_KEY) {
    // TODO: dispatch via FCM — see https://firebase.google.com/docs/cloud-messaging
    await prisma.notification.update({ where: { id: note.id }, data: { sentAt: new Date() } });
  }

  return NextResponse.json(note);
}
