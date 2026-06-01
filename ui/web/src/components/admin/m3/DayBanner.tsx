'use client';
import type { RunBody } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Banner above the run button that tells the desk what's special about
 * today. Friday = Rap-drop day → repricing pulls a new Rap sheet.
 * Monday = freshest demand signals from the weekend. Other days are
 * incremental.
 */
export function DayBanner({
  body,
  setBody,
}: {
  body: RunBody;
  setBody: (b: RunBody) => void;
}) {
  // Today defaults to actual today if not set
  const todayIso = body.today ?? new Date().toISOString().slice(0, 10);
  const date = new Date(todayIso + 'T00:00:00');
  const dow = date.getDay();
  const isFriday = dow === 5;
  const isMonday = dow === 1;
  const isWeekend = dow === 0 || dow === 6;

  const tone =
    isFriday   ? 'bg-gold-500/10 border-gold-500'
  : isMonday   ? 'bg-emerald-50 border-emerald-300'
  : isWeekend  ? 'bg-brand-50/40 border-brand-200'
  :              'bg-brand-50/40 border-brand-200';

  const icon =
    isFriday   ? '📥'
  : isMonday   ? '🌱'
  : isWeekend  ? '😴'
  :              '☀️';

  const headline =
    isFriday   ? "It's Friday — Rap-drop day"
  : isMonday   ? 'Fresh start to the week'
  : isWeekend  ? "Weekend — markets quiet"
  :              `Mid-week run`;

  const detail =
    isFriday
      ? "Repricing will pull in a fresh Rap sheet. You'll see the highest pct_change deltas of the week."
  : isMonday
      ? "Weekend demand signals feed in. Aging triage advances by 2 days vs the last weekday run."
  : isWeekend
      ? "Most desks skip Scintilla on weekends. Memos are continuous so it'll still process pending requests."
  :              "Incremental: prices nudge with daily demand; rap stays unchanged from last Friday.";

  return (
    <div className={`card p-4 border ${tone} flex items-center justify-between gap-4 flex-wrap`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{icon}</span>
        <div>
          <div className="font-serif text-lg text-brand-900">
            {FULL[dow]} · {todayIso}
          </div>
          <div className="text-xs text-brand-700">{headline} — {detail}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-brand-700">Date:</label>
        <input
          type="date"
          value={todayIso}
          onChange={e => setBody({ ...body, today: e.target.value || undefined })}
          className="text-xs border rounded px-2 py-1"
        />
        <div className="flex gap-1 text-[10px]">
          {DAYS.map((d, i) => (
            <span key={i} className={`px-1 py-0.5 rounded ${
              i === dow ? 'bg-brand-900 text-white' : 'text-brand-700/40'
            }`}>{d[0]}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
