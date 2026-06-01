import Link from 'next/link';
import { prisma } from '@/lib/db';
import { RapUploadForm } from './RapUploadForm';

export const dynamic = 'force-dynamic';

export default async function RapRatesPage() {
  const [latest, byShape, recentSheets] = await Promise.all([
    prisma.rapRate.findFirst({ orderBy: { sheetDate: 'desc' } }),
    prisma.rapRate.groupBy({
      by: ['shape', 'sheetDate'],
      _count: { _all: true },
      orderBy: [{ sheetDate: 'desc' }, { shape: 'asc' }],
      take: 50,
    }),
    prisma.rapRate.findMany({
      orderBy: { uploadedAt: 'desc' },
      distinct: ['filename', 'sheetDate'],
      select: { filename: true, sheetDate: true, uploadedAt: true },
      take: 20,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl">Rap Rates</h1>
          <p className="text-sm text-brand-700 mt-1">
            Upload your weekly Rap sheets here. Each sheet is timestamped, so the pricing engine always uses the most recent rate that covers a given stone's category.
          </p>
        </div>
        <Link href="/admin/pricing" className="btn-outline">← Back to Pricing</Link>
      </div>

      <div className="card p-6">
        <h2 className="font-serif text-xl mb-2">Upload Rap sheet(s)</h2>
        <p className="text-sm text-brand-700 mb-4">
          Multiple files allowed (e.g. one per shape). Each file is parsed independently. Expected columns:
          <span className="font-mono mx-1">shape, color, clarity, carat_min, carat_max, rate_per_ct</span>
          (header names are flexible — <span className="font-mono">rap</span>, <span className="font-mono">rap_rate</span>, <span className="font-mono">min</span>, <span className="font-mono">max</span> all work).
        </p>
        <RapUploadForm />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-serif text-xl mb-3">Latest sheet by shape</h2>
          {byShape.length === 0 ? (
            <div className="card p-6 text-center text-sm text-brand-700">No Rap rates uploaded yet.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-50 text-brand-700 text-left">
                  <tr><th className="px-3 py-2">Shape</th><th className="px-3 py-2">Sheet date</th><th className="px-3 py-2 text-right">Rows</th></tr>
                </thead>
                <tbody>
                  {byShape.map((r, i) => (
                    <tr key={i} className="border-t border-brand-100">
                      <td className="px-3 py-2">{r.shape}</td>
                      <td className="px-3 py-2">{new Date(r.sheetDate).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-right">{r._count._all}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h2 className="font-serif text-xl mb-3">Recent uploads</h2>
          {recentSheets.length === 0 ? (
            <div className="card p-6 text-center text-sm text-brand-700">No uploads yet.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-brand-50 text-brand-700 text-left">
                  <tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Sheet date</th><th className="px-3 py-2">Uploaded</th></tr>
                </thead>
                <tbody>
                  {recentSheets.map((r, i) => (
                    <tr key={i} className="border-t border-brand-100">
                      <td className="px-3 py-2 font-mono text-xs truncate max-w-[200px]">{r.filename}</td>
                      <td className="px-3 py-2">{new Date(r.sheetDate).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-xs">{new Date(r.uploadedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {latest && (
        <div className="card p-4 text-xs text-brand-700">
          <b>Latest Rap:</b> {new Date(latest.sheetDate).toLocaleDateString()} — uploaded from <span className="font-mono">{latest.filename}</span> at {new Date(latest.uploadedAt).toLocaleString()}.
        </div>
      )}
    </div>
  );
}
