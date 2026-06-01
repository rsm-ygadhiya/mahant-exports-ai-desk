import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { applyPricing } from '@/lib/pricing';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { buildEnquiryWhatsappUrl } from '@/lib/whatsapp';
import { StatusBadge } from '@/components/StatusBadge';
import { AddToCartButton } from '@/components/AddToCartButton';

export const dynamic = 'force-dynamic';

export default async function DiamondDetailPage({ params }: { params: { id: string } }) {
  const diamond = await prisma.diamond.findUnique({ where: { id: params.id } });
  if (!diamond) notFound();

  const customer = await getCurrentCustomer();
  const priced = applyPricing(diamond, customer, customer?.pricingRule ?? null);
  const signedIn = Boolean(customer);
  const whatsappUrl = buildEnquiryWhatsappUrl([diamond]);

  const rows: Array<[string, React.ReactNode]> = [
    ['Stone ID', <span className="font-mono text-xs">{diamond.stoneId}</span>],
    ['Certificate No', diamond.certificateNo ?? '—'],
    ['Lab', diamond.lab ?? '—'],
    ['Shape', diamond.shape],
    ['Carat', fmtCarat(diamond.carat as any)],
    ['Color', diamond.color],
    ['Clarity', diamond.clarity],
    ['Cut', diamond.cut ?? '—'],
    ['Polish', diamond.polish ?? '—'],
    ['Symmetry', diamond.symmetry ?? '—'],
    ['Fluorescence', diamond.fluorescence ?? '—'],
    ['Measurements', diamond.measurements ?? `${diamond.length ?? '—'} × ${diamond.width ?? '—'} × ${diamond.depth ?? '—'}`],
    ['Table %', diamond.tablePct?.toString() ?? '—'],
    ['Depth %', diamond.depthPct?.toString() ?? '—'],
    ['Ratio', diamond.ratio?.toString() ?? '—'],
    ['Growth', diamond.growthMethod],
    ['Shade', diamond.shade ?? '—'],
    ['Milky', diamond.milky ?? '—'],
    ['Eye Clean', diamond.eyeClean ?? '—'],
    ['Luster', diamond.luster ?? '—'],
    ['Location', diamond.location ?? '—'],
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <Link href="/diamonds" className="text-sm text-brand-700 hover:text-gold-600">← Back to stock</Link>

      <div className="grid md:grid-cols-2 gap-8 mt-4">
        {/* Media */}
        <div className="card p-4">
          <div className="aspect-square w-full bg-gradient-to-br from-brand-50 to-brand-100 rounded-md
                          flex items-center justify-center text-brand-200 text-6xl font-serif">
            ◆
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {diamond.videoUrl && (
              <a href={diamond.videoUrl} target="_blank" rel="noreferrer" className="btn-outline">
                ▶ Watch video
              </a>
            )}
            {diamond.certificateUrl && (
              <a href={diamond.certificateUrl} target="_blank" rel="noreferrer" className="btn-outline">
                📄 View certificate
              </a>
            )}
          </div>
        </div>

        {/* Detail */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <StatusBadge status={diamond.status} />
            <span className="text-xs text-brand-700">{diamond.lab} · {diamond.certificateNo}</span>
          </div>
          <h1 className="font-serif text-3xl">
            {fmtCarat(diamond.carat as any)} ct {diamond.shape} · {diamond.color} {diamond.clarity}
          </h1>

          <div className="card p-6 mt-4">
            <div className="text-xs uppercase tracking-widest text-brand-700">Price</div>
            {priced.priceHidden ? (
              <div className="mt-2">
                {signedIn
                  ? <p className="text-brand-900">Price hidden — please send an enquiry.</p>
                  : <Link href="/login" className="text-gold-600 underline">Sign in to see price</Link>}
              </div>
            ) : (
              <>
                <div className="text-3xl font-serif text-brand-900 mt-1">
                  {fmtUsd(priced.totalPrice as any)}
                </div>
                <div className="text-sm text-brand-700">
                  {fmtUsd(priced.pricePerCarat as any)} / ct
                </div>
              </>
            )}

            {diamond.status === 'AVAILABLE' && (
              <div className="flex gap-3 mt-6">
                <AddToCartButton diamondId={diamond.id} signedIn={signedIn} />
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn-outline">
                  Enquire on WhatsApp
                </a>
              </div>
            )}
          </div>

          <div className="card p-6 mt-4">
            <div className="text-xs uppercase tracking-widest text-brand-700 mb-3">Specifications</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-brand-50 py-1">
                  <dt className="text-brand-700">{k}</dt>
                  <dd className="text-brand-900 text-right">{v}</dd>
                </div>
              ))}
            </dl>
            {diamond.remarks && (
              <p className="mt-4 text-sm text-brand-700">
                <span className="text-xs uppercase tracking-widest">Remarks</span><br/>
                {diamond.remarks}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
