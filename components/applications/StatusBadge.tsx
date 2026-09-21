'use client';

import { statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: ApplicationStatus;
}

/** Colour carries the meaning here, so it comes from the semantic tokens:
 *  amber while something is pending, green for an offer, red for a no. */
const STYLES: Record<ApplicationStatus, string> = {
  draft: 'border-line bg-surface-2 text-ink-dim',
  applied: 'border-accent bg-surface-2 text-accent',
  interviewing: 'border-warning-line bg-warning-surface/40 text-warning-ink',
  offered: 'border-success-line bg-success-surface/40 text-success-ink',
  rejected: 'border-danger-line bg-danger-surface/40 text-danger-ink',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${STYLES[status]}`}
    >
      {statusLabel(status)}
    </span>
  );
}
