import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { TemplatesManager } from './TemplatesManager';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!hasPermission(me as any, 'templates', 'edit')) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-serif text-2xl">Restricted</h1>
        <p className="text-sm text-brand-700 mt-2">
          Only roles with templates-edit permission (Owner by default) can edit
          customer-facing message templates.
        </p>
      </div>
    );
  }

  const templates = await prisma.messageTemplate.findMany({
    orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Message Templates</h1>
        <p className="text-sm text-brand-700 mt-1">
          Edit the wording, subject, and channel for every customer-facing message
          (KYC, memo approval, sale confirmation, payment reminders, bank details).
          Use <span className="font-mono">{'{{placeholder}}'}</span> to insert dynamic values —
          available placeholders are listed under each template.
        </p>
      </div>

      <TemplatesManager templates={templates.map(t => ({
        id: t.id, key: t.key, name: t.name, description: t.description,
        subject: t.subject ?? '', body: t.body, channel: t.channel,
        isSystem: t.isSystem,
        updatedAt: t.updatedAt.toISOString(),
      }))} />
    </div>
  );
}
