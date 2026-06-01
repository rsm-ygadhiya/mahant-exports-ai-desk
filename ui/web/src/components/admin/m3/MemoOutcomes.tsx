'use client';
import { useMemo, useState } from 'react';
import type { Step } from './types';
import { MemoDetailModal } from './MemoDetailModal';

type Verdict = 'approved' | 'rejected';

/**
 * The visual centerpiece. Memo rows go into one of three columns:
 *
 *   ✅ Auto-approved   — clear APPROVE that passed every gate
 *   ❌ Auto-rejected   — clear REJECT we can decline without asking
 *   ⚠ Needs your sign-off — anything ambiguous: conditional approval,
 *      borderline scores, REJECT against a top-tier customer, etc.
 *
 * Approve / Reject buttons live on the third column. Clicking either
 * fades the card out and emits a "📨 Drafted reply sent" toast, so the
 * desk sees the full loop close visually.
 */
export function MemoOutcomes({
  step,
  onAction,
}: {
  step: Step;
  onAction: (verdict: Verdict, memo: Record<string, string>) => void;
}) {
  const buckets = useMemo(() => {
    const auto:   Record<string, string>[] = [];
    const reject: Record<string, string>[] = [];
    const review: Record<string, string>[] = [];
    for (const r of step.decisions) {
      if (r.queue === 'auto_approve') auto.push(r);
      else if (r.queue === 'auto_reject') reject.push(r);
      else review.push(r);
    }
    return { auto, reject, review };
  }, [step]);

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [openMemoId, setOpenMemoId] = useState<string | null>(null);

  function decide(memoId: string, verdict: Verdict, row: Record<string, string>) {
    setVerdicts(prev => ({ ...prev, [memoId]: verdict }));
    onAction(verdict, row);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-serif text-xl text-brand-900">📝 Memo decisions</div>
          <div className="text-xs text-brand-700">
            Continuous — runs as memo requests come in. Clear cases auto-route;
            ambiguous ones land in your sign-off queue.
          </div>
        </div>
        <div className="text-xs text-brand-700">
          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 mr-1">
            ✅ {buckets.auto.length} auto-approved
          </span>
          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 mr-1">
            ❌ {buckets.reject.length} auto-rejected
          </span>
          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            ⚠ {buckets.review.length} need your sign-off
          </span>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {/* Column 1 — auto approved */}
        <Column
          title="✅ Auto-approved"
          tone="emerald"
          subtitle="Released to broker / customer. Reply draft queued."
          rows={buckets.auto}
          empty="Nothing auto-approved this run."
          renderRow={(r) => (
            <CompactCard row={r} accent="emerald" onOpen={() => setOpenMemoId(r.memo_id)} />
          )}
        />

        {/* Column 2 — auto rejected */}
        <Column
          title="❌ Auto-rejected"
          tone="rose"
          subtitle="Polite decline draft queued. No human ping."
          rows={buckets.reject}
          empty="No memos clearly rejectable this run."
          renderRow={(r) => (
            <CompactCard row={r} accent="rose" onOpen={() => setOpenMemoId(r.memo_id)} />
          )}
        />

        {/* Column 3 — needs human */}
        <Column
          title="⚠ Needs your sign-off"
          tone="amber"
          subtitle="Click a card for full detail. Approve sends the memo, Reject sends a decline."
          rows={buckets.review}
          empty="Nothing to sign off on. Nice work."
          renderRow={(r) => (
            <SignoffCard
              row={r}
              verdict={verdicts[r.memo_id] ?? null}
              onDecide={(v) => decide(r.memo_id, v, r)}
              onOpen={() => setOpenMemoId(r.memo_id)}
            />
          )}
        />
      </div>

      {openMemoId && (
        <MemoDetailModal
          memoId={openMemoId}
          onClose={() => setOpenMemoId(null)}
          showActions={
            // Only show Approve/Reject when the memo is still in the sign-off
            // queue and hasn't already been verdicted in this session.
            buckets.review.some(r => r.memo_id === openMemoId)
            && verdicts[openMemoId] === undefined
          }
          onDecide={(v) => {
            const row = step.decisions.find(d => d.memo_id === openMemoId);
            if (row) decide(openMemoId, v, row);
          }}
        />
      )}
    </div>
  );
}

function Column({
  title, tone, subtitle, rows, empty, renderRow,
}: {
  title: string;
  tone: 'emerald' | 'rose' | 'amber';
  subtitle: string;
  rows: Record<string, string>[];
  empty: string;
  renderRow: (r: Record<string, string>) => React.ReactNode;
}) {
  const headerCls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-800'
                  : tone === 'rose'    ? 'bg-rose-50 text-rose-800'
                  :                       'bg-amber-50 text-amber-800';

  return (
    <div className="card overflow-hidden">
      <div className={`p-3 ${headerCls}`}>
        <div className="font-medium">{title}</div>
        <div className="text-[11px] opacity-80 mt-0.5">{subtitle}</div>
      </div>
      <div className="p-3 space-y-2 max-h-[600px] overflow-y-auto">
        {rows.length === 0
          ? <div className="text-xs text-brand-700/60 text-center py-6">{empty}</div>
          : rows.map((r, i) => <div key={r.memo_id || i}>{renderRow(r)}</div>)
        }
      </div>
    </div>
  );
}

function CompactCard({ row, accent, onOpen }: {
  row: Record<string, string>;
  accent: 'emerald' | 'rose';
  onOpen: () => void;
}) {
  const tierCls = row.tier === 'Top'   ? 'bg-gold-500/10 text-gold-700'
                : row.tier === 'High'  ? 'bg-emerald-50 text-emerald-700'
                : row.tier === 'Mid'   ? 'bg-brand-50 text-brand-700'
                :                         'bg-rose-50 text-rose-700';
  const dotCls = accent === 'emerald' ? 'text-emerald-500' : 'text-rose-500';
  return (
    <button
      onClick={onOpen}
      className="border rounded p-2 w-full text-left hover:bg-brand-50/40 hover:ring-1 hover:ring-brand-200 transition"
      title="Click for stone + customer + CLV detail"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono">{row.memo_id}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierCls}`}>{row.tier}</span>
      </div>
      <div className="text-[11px] text-brand-700 mt-1">
        <span className={`mr-1 ${dotCls}`}>●</span>
        {row.route_reason || row.reason || '—'}
      </div>
      <div className="text-[10px] text-brand-700/70 mt-1 truncate" title={row.rationale}>
        {row.rationale}
      </div>
    </button>
  );
}

function SignoffCard({
  row, verdict, onDecide, onOpen,
}: {
  row: Record<string, string>;
  verdict: Verdict | null;
  onDecide: (v: Verdict) => void;
  onOpen: () => void;
}) {
  const tierCls = row.tier === 'Top'   ? 'bg-gold-500/10 text-gold-700'
                : row.tier === 'High'  ? 'bg-emerald-50 text-emerald-700'
                : row.tier === 'Mid'   ? 'bg-brand-50 text-brand-700'
                :                         'bg-rose-50 text-rose-700';
  const decisionCls = row.decision === 'APPROVE_WITH_CONDITIONS' ? 'bg-amber-100 text-amber-800'
                    : row.decision === 'REVIEW'                   ? 'bg-amber-100 text-amber-800'
                    : row.decision === 'APPROVE'                  ? 'bg-emerald-100 text-emerald-700'
                    :                                                'bg-rose-100 text-rose-700';

  if (verdict !== null) {
    return (
      <div className={`border rounded p-2 opacity-70 ${
        verdict === 'approved' ? 'bg-emerald-50/40' : 'bg-rose-50/40'
      }`}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono">{row.memo_id}</span>
          <span className="text-[10px] text-brand-700">
            {verdict === 'approved' ? '✅ approved · draft sent' : '❌ rejected · decline sent'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded p-2 bg-amber-50/30">
      <button
        onClick={onOpen}
        className="w-full text-left flex items-center justify-between text-xs mb-1 hover:underline"
        title="Click for full memo / stone / customer detail"
      >
        <span className="font-mono">{row.memo_id}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierCls}`}>{row.tier}</span>
      </button>
      <div className="text-[11px] text-brand-700 mb-1 flex items-center gap-1">
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${decisionCls}`}>{row.decision}</span>
        <span className="text-brand-700/70">·</span>
        <span className="truncate">rel {row.reliability_score} · opp {row.opportunity_score}</span>
      </div>
      <div className="text-[10px] text-brand-700/80 italic" title={row.rationale}>
        {row.route_reason || row.rationale || '—'}
      </div>
      <div className="flex gap-1 mt-2">
        <button
          onClick={() => onDecide('approved')}
          className="flex-1 px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700"
        >
          ✅ Approve & send memo
        </button>
        <button
          onClick={() => onDecide('rejected')}
          className="flex-1 px-2 py-1 rounded bg-rose-600 text-white text-[11px] hover:bg-rose-700"
        >
          ❌ Reject & send decline
        </button>
      </div>
    </div>
  );
}
