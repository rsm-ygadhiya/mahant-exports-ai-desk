import type { DiamondStatus } from '@prisma/client';

const MAP: Record<DiamondStatus, { cls: string; label: string }> = {
  AVAILABLE: { cls: 'badge-green', label: 'Live' },
  HOLD:      { cls: 'badge-amber', label: 'On Memo' },
  SOLD:      { cls: 'badge-red',   label: 'Sold' },
  NOT_LIVE:  { cls: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200',
               label: 'Not Live' },
};

export function StatusBadge({ status }: { status: DiamondStatus }) {
  const { cls, label } = MAP[status];
  return <span className={cls}>{label}</span>;
}
