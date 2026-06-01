import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { isOwner } from '@/lib/permissions';
import { Pagination } from '@/components/Pagination';

export const dynamic = 'force-dynamic';

// Friendly labels for the action codes stored in AuditLog.action.
const ACTION_LABELS: Record<string, string> = {
  'permission.grant':       '🔐 Permission granted',
  'permission.revoke':      '🔐 Permission revoked',
  'permission.replace':     '🔐 Permission updated',
  'admin.create':           '👤 Admin created',
  'admin.deactivate':       '👤 Admin deactivated',
  'admin.reactivate':       '👤 Admin reactivated',
  'admin.role_change':      '👤 Admin role changed',
  'kyc.approve':            '✓ KYC approved',
  'kyc.reject':             '✗ KYC rejected',
  'kyc.request_docs':       '📩 KYC docs requested',
  'cash.approve':           '💵 Cash payment / approval',
  'stone.set_live':         '🟢 Stone set live',
  'stone.set_not_live':     '🔴 Stone hidden from buyers',
  'stone.status_change':    '🔄 Stone status changed',
  'stone.import':           '📥 Stone Excel import',
  'rap.import':             '📥 Rap sheet import',
  'enquiry.approve_memo':   '📝 Enquiry → Memo',
  'enquiry.approve_sale':   '🤝 Enquiry → Sale',
  'enquiry.cancel':         '✗ Enquiry cancelled',
  'pricing.apply':          '💎 Pricing applied to inventory',
  'pricing.proposal_edit':  '💎 Pricing proposal edited',
  'pricing.run.create':     '💎 Pricing run created',
  'pricing.run.decide':     '💎 Pricing proposals decided',
  'customer.edit':          '👥 Customer edited',
  'backup.create':          '💾 Backup created',
  'backup.delete':          '💾 Backup deleted',
};

const TARGET_LINKS: Record<string, (id: string) => string | null> = {
  Admin: () => '/admin/team',
  Customer: id => `/admin/customers/${id}`,
  Order: id => `/admin/sales/${id}`,
  PricingRun: id => `/admin/pricing/runs/${id}`,
  Diamond: () => '/admin/diamonds',
  Enquiry: id => `/admin/enquiries/${id}`,
  Role: () => '/admin/team',
  MessageTemplate: () => '/admin/templates',
};

const DAYS = ['', '1', '7', '30', '90', '365'];

export default async function AuditPage({
  searchParams,
}: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await getCurrentAdmin();
  if (!me) redirect('/admin/login');
  if (!isOwner(me as any)) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-serif text-2xl">Restricted</h1>
        <p className="text-sm text-brand-700 mt-2">
          The full audit log is Owner-only. Each non-Owner admin sees their own
          actions on their relevant entity pages (e.g. order history).
        </p>
      </div>
    );
  }

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v);
  }
  const actorId    = sp.get('actor') ?? '';
  const actionLike = sp.get('action') ?? '';
  const targetType = sp.get('target') ?? '';
  const daysBack   = Number(sp.get('days') ?? 30);
  const q          = sp.get('q') ?? '';
  const page       = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize   = Math.min(200, Math.max(10, Number(sp.get('pageSize')) || 50));

  const since = daysBack > 0 ? new Date(Date.now() - daysBack * 86_400_000) : null;

  const where: any = {};
  if (actorId)    where.actorId = actorId;
  if (actionLike) where.action = { contains: actionLike };
  if (targetType) where.targetType = targetType;
  if (since)      where.createdAt = { gte: since };
  if (q) {
    where.OR = [
      { notes: { contains: q, mode: 'insensitive' } },
      { targetId: { contains: q } },
      { action: { contains: q } },
    ];
  }

  const [entries, total, admins, targetTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, name: true, email: true, role: true } } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.admin.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: 'asc' } }),
    prisma.auditLog.groupBy({ by: ['targetType'], _count: { _all: true } }),
  ]);

  // Build helper links that preserve current filters when changing one.
  const linkFor = (overrides: Record<string, string>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    next.delete('page');
    const qs = next.toString();
    return '/admin/audit' + (qs ? `?${qs}` : '');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">Audit Log</h1>
        <p className="text-sm text-brand-700 mt-1">
          Every privileged action — who did it, when, and what changed.
          Append-only: entries can never be modified or deleted.
        </p>
      </div>

      <div className="card p-3 space-y-3 text-sm">
        <form action="/admin/audit" className="grid md:grid-cols-5 gap-3 items-end">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Actor</span>
            <select name="actor" defaultValue={actorId} className="input mt-1">
              <option value="">Anyone</option>
              {admins.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Action contains</span>
            <input name="action" defaultValue={actionLike}
                   placeholder="e.g. kyc, cash, pricing"
                   className="input mt-1" />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Target type</span>
            <select name="target" defaultValue={targetType} className="input mt-1">
              <option value="">Any</option>
              {targetTypes.map(t => t.targetType && (
                <option key={t.targetType} value={t.targetType}>
                  {t.targetType} ({t._count._all})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Days back</span>
            <select name="days" defaultValue={String(daysBack)} className="input mt-1">
              {DAYS.map(d => <option key={d || 'all'} value={d}>{d ? `Last ${d} day${d === '1' ? '' : 's'}` : 'All time'}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-brand-700">Search</span>
            <div className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="notes, target ID…" className="input mt-1 flex-1" />
              <button className="btn-primary text-xs mt-1">Filter</button>
            </div>
          </label>
        </form>
        {(actorId || actionLike || targetType || q || daysBack !== 30) && (
          <div className="text-xs">
            <Link href="/admin/audit" className="text-brand-700 hover:underline">Clear filters →</Link>
          </div>
        )}
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/audit" searchParams={sp} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2 w-44">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const linkFn = e.targetType ? TARGET_LINKS[e.targetType] : null;
              const targetHref = linkFn && e.targetId ? linkFn(e.targetId) : null;
              const actionLabel = ACTION_LABELS[e.action] ?? e.action;
              return (
                <tr key={e.id} className="border-t border-brand-100 align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{e.actor.name}</div>
                    <div className="text-xs text-brand-700">
                      {e.actor.email} · <RolePill role={e.actor.role} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{actionLabel}</div>
                    <div className="text-[10px] font-mono text-brand-700/60">{e.action}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {e.targetType && (
                      <>
                        <div className="text-brand-700">{e.targetType}</div>
                        {targetHref ? (
                          <Link href={targetHref} className="font-mono text-gold-600 hover:underline">
                            {(e.targetId ?? '').slice(0, 12)}…
                          </Link>
                        ) : (
                          <div className="font-mono">{(e.targetId ?? '').slice(0, 12)}…</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[480px]">
                    {e.notes && <div className="text-brand-900 mb-1">{e.notes}</div>}
                    {(e.oldValue || e.newValue) && (
                      <details>
                        <summary className="cursor-pointer text-brand-700 hover:text-gold-600">
                          Show old → new
                        </summary>
                        <div className="grid grid-cols-2 gap-2 mt-1 text-[11px] font-mono">
                          <div>
                            <div className="text-rose-700 mb-1">old</div>
                            <pre className="bg-rose-50/40 p-1 rounded whitespace-pre-wrap break-all">{JSON.stringify(e.oldValue ?? null, null, 2)}</pre>
                          </div>
                          <div>
                            <div className="text-emerald-700 mb-1">new</div>
                            <pre className="bg-emerald-50/40 p-1 rounded whitespace-pre-wrap break-all">{JSON.stringify(e.newValue ?? null, null, 2)}</pre>
                          </div>
                        </div>
                      </details>
                    )}
                    {e.ipAddress && <div className="text-brand-700/60 mt-1">ip {e.ipAddress}</div>}
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-brand-700">
                No audit entries match these filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} pageSize={pageSize}
                  basePath="/admin/audit" searchParams={sp} />
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const cls = role === 'OWNER' ? 'text-gold-700'
            : role === 'SALES' ? 'text-emerald-700'
            : 'text-rose-700';
  return <span className={`uppercase tracking-widest text-[10px] ${cls}`}>{role}</span>;
}
