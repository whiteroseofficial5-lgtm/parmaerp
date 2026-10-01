import { cn, humanize } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-tint text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
};

const MAP: Record<string, Tone> = {
  // generic / lifecycle
  DRAFT: 'neutral', PLANNED: 'neutral', OPEN: 'neutral', NOT_STARTED: 'neutral', INACTIVE: 'neutral', CANCELLED: 'neutral', OBSOLETE: 'neutral', DEPLETED: 'neutral', UPLOADED: 'neutral',
  APPROVED: 'success', RELEASED: 'success', PASSED: 'success', ACTIVE: 'success', RECEIVED: 'success', COMPLETED: 'success', MATCHED: 'success', PAID: 'success', OK: 'success', POSTED: 'success', RECONCILED: 'success', LOW: 'success', CLOSED: 'success',
  IN_PRODUCTION: 'info', IN_PROGRESS: 'info', SCHEDULED: 'info', PROCESSING: 'info', IN_TESTING: 'info', IN_TRANSIT: 'info', SUBMITTED: 'info', INFO: 'info', RELEASED_SHORT: 'info',
  QC_REVIEW: 'warning', PENDING: 'warning', PENDING_APPROVAL: 'warning', PENDING_REVIEW: 'warning', QUARANTINE: 'warning', REORDER: 'warning', PARTIALLY_RECEIVED: 'warning', REVIEW: 'warning', WARNING: 'warning', MEDIUM: 'warning', INITIATED: 'warning', BLOCKED: 'warning',
  REJECTED: 'danger', FAILED: 'danger', EXPIRED: 'danger', RECALLED: 'danger', CRITICAL: 'danger', OUT_OF_STOCK: 'danger', MISMATCH: 'danger', FAIL: 'danger', HIGH: 'danger',
  PASS: 'success',
};

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-xs font-medium', TONES[MAP[status] ?? 'neutral'], className)}>{humanize(status)}</span>;
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', { neutral: 'bg-muted-foreground', info: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone])} />;
}
