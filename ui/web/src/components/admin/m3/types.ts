/** Shared types between the M3 workflow API route and the UI page. */

export type StepName =
  | 'triage-inventory'
  | 'propose-repricing'
  | 'rank-customer-clv'
  | 'decide-memo';

export type Envelope = {
  status: string;
  skill_name: string;
  next_action?: string;
  review_required?: boolean;
  confidence?: number;
  artifact_refs?: string[];
  outputs?: Record<string, unknown>;
  error?: unknown;
};

export type Step = {
  name: StepName;
  envelope: Envelope;
  decisions: Record<string, string>[];
  artifact: string;
};

export type RunResult = {
  run_id: string;
  today: string;
  steps: Step[];
  stderr?: string;
};

export type RunBody = {
  today?: string;
  thresholdPct?: number;
  oppCeiling?: number;
  autoTiers?: string[];
  scenario?: string;
};

/** UI-friendly metadata per step — labels, colors, the column it routes on. */
export const STEP_META: Record<StepName, {
  label: string;
  emoji: string;
  blurb: string;
  /** Which CSV column holds the routing queue, if any. */
  queueColumn?: string;
  /** Which value(s) in that column mean "needs human review". */
  reviewValues?: string[];
}> = {
  'triage-inventory': {
    label: 'Triage Inventory',
    emoji: '⏳',
    blurb: 'Tag every available stone HOLD / WATCH / DISCOUNT / CLEAR.',
  },
  'propose-repricing': {
    label: 'Propose Repricing',
    emoji: '💎',
    blurb: 'Recompute prices off the latest Rap. Split into auto vs review.',
    queueColumn: 'queue',
    reviewValues: ['review'],
  },
  'rank-customer-clv': {
    label: 'Rank Customer CLV',
    emoji: '👑',
    blurb: 'Compute CLV per broker/company and bucket into quartile tiers.',
  },
  'decide-memo': {
    label: 'Decide Memo',
    emoji: '📝',
    blurb: 'Approve / conditional / reject each pending memo; route to human if not auto.',
    queueColumn: 'queue',
    reviewValues: ['review', 'needs_review'],
  },
};
