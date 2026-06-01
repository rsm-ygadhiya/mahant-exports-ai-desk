import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { getPriceHistoryForStone, type PriceEvent } from '@/lib/priceHistory';
import { StatusBadge } from '@/components/StatusBadge';

export const dynamic = 'force-dynamic';

const EVENT_ICONS: Record<PriceEvent['type'], string> = {
  created: '✨',
  set_live: '🟢',
  price_edit: '✎',
  status_change: '🔄',
  pricing_run: '💎',
  other: '·',
};

export default async function StoneDetailPage({ params }: { params: { id: string } }) {
  const me = await getCurrentAdmin();
  if (!me || !hasPermission(me as any, 'inventory', 'view')) {
    return <div className="card p-6 text-sm text-brand-700">No access.</div>;
  }

  const stone = await prisma.diamond.findUnique({
    where: { id: params.id },
    include: {
      orderItems: {
        include: { order: { include: { customer: { select: { id: true, companyName: true, uniqueCode: true } } } } },
        orderBy: { id: 'desc' },
      },
      enquiryItems: {
        include: { enquiry: { include: { customer: { select: { id: true, companyName: true } } } } },
        orderBy: { id: 'desc' },
        take: 10,
      },
    },
  });
  if (!stone) return notFound();

  const history = await getPriceHistoryForStone(stone.id);

  // Compute high-level price stats.
  const priceEvents = history.filter(e => e.newPpc != null);
  const firstPpc = priceEvents.length ? priceEvents[priceEvents.length - 1].newPpc! : Number(stone.pricePerCarat);
  const currentPpc = Number(stone.pricePerCarat);
  const lifetimeChangePct = firstPpc > 0 ? ((currentPpc - firstPpc) / firstPpc) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin/diamonds" className="text-xs text-brand-700 hover:underline">← All stones</Link>
          <h1 className="font-serif text-3xl mt-2 font-mono">{stone.stoneId}</h1>
          <p className="text-sm text-brand-700">
            {stone.shape} · {fmtCarat(stone.carat as any)} · {stone.color}/{stone.clarity}
            {stone.cut && <> · cut {stone.cut}</>}
            {stone.polish && <> · pol {stone.polish}</>}
            {stone.symmetry && <> · sym {stone.symmetry}</>}
            {stone.fluorescence && <> · fl {stone.fluorescence}</>}
          </p>
          {stone.lab && (
            <p className="text-xs text-brand-700 mt-1">
              {stone.lab} {stone.certificateNo}
              {stone.certificateUrl && (
                <> · <a href={stone.certificateUrl} target="_blank" className="text-gold-600 hover:underline">Cert PDF</a></>
              )}
              {stone.videoUrl && (
                <> · <a href={stone.videoUrl} target="_blank" className="text-gold-600 hover:underline">Video</a></>
              )}
            </p>
          )}
        </div>
        <div className="text-right">
          <StatusBadge status={stone.status} />
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <Kpi label="Current $/ct" value={fmtUsd(currentPpc)} />
        <Kpi label="Current total" value={fmtUsd(Number(stone.totalPrice))} />
        <Kpi label="First priced at" value={fmtUsd(firstPpc)} />
        <Kpi
          label="Lifetime change"
          value={`${lifetimeChangePct >= 0 ? '+' : ''}${lifetimeChangePct.toFixed(1)}%`}
          tone={lifetimeChangePct < 0 ? 'rose' : lifetimeChangePct > 0 ? 'green' : 'brand'}
        />
      </div>

      <div className="card p-6 space-y-3">
        <h2 className="font-serif text-xl">Price &amp; status history</h2>
        <p className="text-xs text-brand-700">
          Every change to this stone, in reverse chronological order. Sourced from the audit log
          and applied pricing-run proposals. Append-only — entries can never be modified.
        </p>

        {history.length === 0 ? (
          <p className="text-sm text-brand-700">No history yet.</p>
        ) : (
          <div className="border-l-2 border-brand-100 ml-3 pl-4 space-y-4">
            {history.map(e => (
              <div key={e.id} className="relative">
                <div className="absolute -left-[1.4rem] top-1.5 w-5 h-5 rounded-full bg-white border-2 border-brand-100 flex items-center justify-center text-xs">
                  {EVENT_ICONS[e.type]}
                </div>
                <div className="text-xs text-brand-700">{new Date(e.at).toLocaleString()}</div>
                <div className="mt-1 flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="font-medium text-brand-900">{e.label}</div>
                  {e.newPpc != null && (
                    <div className="text-sm whitespace-nowrap">
                      {e.oldPpc != null && e.oldPpc !== e.newPpc && (
                        <>
                          <span className="text-brand-700 line-through mr-2">{fmtUsd(e.oldPpc)}</span>
                          <span className="text-brand-700 mr-2">→</span>
                        </>
                      )}
                      <span className="font-medium">{fmtUsd(e.newPpc)}</span>
                      {e.oldPpc != null && e.oldPpc !== e.newPpc && (
                        <span className={`ml-2 text-xs ${e.newPpc < e.oldPpc ? 'text-rose-700' : 'text-emerald-700'}`}>
                          ({(((e.newPpc - e.oldPpc) / e.oldPpc) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {(e.oldStatus || e.newStatus) && (
                  <div className="text-xs text-brand-700 mt-0.5">
                    Status: {e.oldStatus ?? '—'} → <b>{e.newStatus ?? '—'}</b>
                  </div>
                )}
                {e.reasoning && (
                  <div className="text-xs text-brand-700/80 mt-1 italic">{e.reasoning}</div>
                )}
                <div className="text-xs text-brand-700 mt-1 flex gap-3">
                  {e.actor && (
                    <span>by <b>{e.actor.name}</b> <span className="text-brand-700/70">({e.actor.email}, {e.actor.role})</span></span>
                  )}
                  {e.link && <Link href={e.link.href} className="text-gold-600 hover:underline">{e.link.label}</Link>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="font-serif text-lg mb-2">Orders containing this stone</h3>
          {stone.orderItems.length === 0 ? (
            <p className="text-sm text-brand-700">Never sold.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stone.orderItems.map(it => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span>
                    <Link href={`/admin/sales/${it.order.id}`} className="font-mono text-gold-700 hover:underline">{it.order.orderCode}</Link>
                    {' '}— {' '}
                    <Link href={`/admin/customers/${it.order.customer.id}`} className="hover:underline">
                      {it.order.customer.companyName}
                    </Link>
                  </span>
                  <span className="text-brand-700">{fmtUsd(Number(it.totalPrice))} · {it.order.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4">
          <h3 className="font-serif text-lg mb-2">Recent enquiries</h3>
          {stone.enquiryItems.length === 0 ? (
            <p className="text-sm text-brand-700">No enquiries yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stone.enquiryItems.map(it => (
                <li key={it.id} className="flex justify-between gap-2">
                  <span>
                    <Link href={`/admin/enquiries/${it.enquiry.id}`} className="hover:underline">
                      {new Date(it.enquiry.createdAt).toLocaleDateString()}
                    </Link>
                    {' '}— {' '}
                    <Link href={`/admin/customers/${it.enquiry.customer.id}`} className="hover:underline">
                      {it.enquiry.customer.companyName}
                    </Link>
                  </span>
                  <span className="text-brand-700 text-xs">{it.enquiry.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'rose' | 'brand' }) {
  const cls = tone === 'green' ? 'text-emerald-700'
            : tone === 'rose'  ? 'text-rose-700'
            : tone === 'brand' ? 'text-brand-700' : 'text-brand-900';
  return (
    <div className="card p-3">
      <div className="text-xs uppercase tracking-widest text-brand-700">{label}</div>
      <div className={`text-2xl font-serif mt-1 ${cls}`}>{value}</div>
    </div>
  );
}
