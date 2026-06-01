import Link from 'next/link';
import { prisma } from '@/lib/db';

export default async function HomePage() {
  const totalAvailable = await prisma.diamond.count({ where: { status: 'AVAILABLE' } });

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900 via-brand-700 to-brand-900" />
        <div className="absolute inset-0 opacity-20"
             style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
        <div className="relative max-w-7xl mx-auto px-4 py-24 text-white">
          <div className="text-xs uppercase tracking-widest text-gold-400 mb-4">Mahant Exports</div>
          <h1 className="font-serif text-5xl md:text-6xl max-w-3xl leading-tight">
            Lab-grown brilliance,<br/>
            <span className="text-gold-400">manufactured certainty.</span>
          </h1>
          <p className="mt-6 text-brand-100 max-w-xl">
            Search our certified IGI / GIA / GCAL stock, view full gemological detail,
            and send enquiries — direct to our trade desk.
          </p>
          <div className="mt-10 flex gap-4">
            <Link href="/diamonds" className="btn-gold">Browse Stock</Link>
            <Link href="/login" className="btn-outline border-white/40 text-white hover:bg-white/10">
              Buyer login
            </Link>
          </div>
          <div className="mt-12 inline-flex items-center gap-3 text-sm text-brand-100">
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{totalAvailable.toLocaleString()} stones available right now</span>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-16 grid md:grid-cols-3 gap-6">
        {[
          { t: 'Certified', d: 'Every stone IGI / GIA / GCAL certified. Reports & videos one click away.' },
          { t: 'Direct trade pricing', d: 'Buyer-tier pricing applied automatically once you’re approved.' },
          { t: 'Instant enquiry', d: 'Build a cart, send via WhatsApp or in-app — we respond same day.' },
        ].map(c => (
          <div key={c.t} className="card p-6">
            <div className="text-xs uppercase tracking-widest text-gold-600 mb-2">{c.t}</div>
            <div className="text-brand-900">{c.d}</div>
          </div>
        ))}
      </section>
    </>
  );
}
