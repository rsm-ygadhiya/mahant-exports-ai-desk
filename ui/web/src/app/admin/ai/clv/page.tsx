'use client';
import { AiRunPanel, Pill } from '@/components/admin/AiRunPanel';
import { fmtUsd } from '@/lib/format';
import type { CLVResult, CustomerCLV } from '@/lib/ai-skills/clvAnalysis';

const TIER_TONE = { Top: 'gold', High: 'amber', Mid: 'brand', Low: 'brand' } as const;

function CustomerTable({ customers, title }: { customers: CustomerCLV[]; title: string }) {
  return (
    <div>
      <h2 className="font-serif text-xl mb-3">{title}</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-50 text-brand-700 text-left">
            <tr>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2 text-right">Est. CLV</th>
              <th className="px-3 py-2 text-right">Enquiries</th>
              <th className="px-3 py-2">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.customerId} className="border-t border-brand-100 align-top">
                <td className="px-3 py-2"><Pill tone={TIER_TONE[c.tier]}>{c.tier}</Pill></td>
                <td className="px-3 py-2">
                  <div className="font-medium">{c.companyName}</div>
                  <div className="text-xs text-brand-700">conv ~{c.conversionEstimate}</div>
                </td>
                <td className="px-3 py-2 text-right font-medium">{fmtUsd(c.estimatedCLV)}</td>
                <td className="px-3 py-2 text-right">{c.enquiryCount}</td>
                <td className="px-3 py-2 text-sm">{c.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ClvPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-3xl">👑 CLV Analysis</h1>
        <p className="text-sm text-brand-700">
          Estimates customer lifetime value from enquiry history. Identifies top accounts to protect
          and at-risk relationships to re-engage.
        </p>
      </div>

      <AiRunPanel<CLVResult>
        skill="clv"
        buttonLabel="Analyze customer portfolio"
        render={(r) => (
          <div className="space-y-6">
            <div className="card p-5 bg-gradient-to-br from-brand-700 to-brand-900 text-white">
              <p className="text-sm text-brand-100">{r.summary}</p>
            </div>
            <CustomerTable customers={r.topCustomers} title="Top customers — protect" />
            <CustomerTable customers={r.atRisk} title="At-risk — re-engage" />
          </div>
        )}
      />
    </div>
  );
}
