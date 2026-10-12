'use client';

import { statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/types';

interface StatusBadgeProps {
  status: ApplicationStatus;
}

/** Colour carries the meaning here, so it comes from the semantic tokens:
 *  amber while something is pending, green for an offer or an approved
 *  application, red for a no. `proposing` is dashed because nothing is
 *  being asked of you yet — the agent is still working. */
const STYLES: Record<ApplicationStatus, string> = {
  draft: 'border-line bg-surface-2 text-ink-dim',
  proposing: 'border-dashed border-line bg-surface-2 text-ink-dim',
  needs_review: 'border-warning-line-strong bg-warning-surface/20 text-warning',
  ready: 'border-success-line bg-success-surface/20 text-success',
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
