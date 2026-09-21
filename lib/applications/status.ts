/**
 * The application status vocabulary, and the one rule that governs moving
 * between values. Pure and framework-free — the query layer, the zod schema
 * and the UI all read the vocabulary from here rather than restating it.
 *
 * There are five statuses and no transition graph: any status can follow any
 * other, because real applications do not proceed tidily (a recruiter reopens
 * a rejection; you realise you never actually sent the thing). The single
 * rule that *is* enforced is `appliedAt`: it is set the first time an
 * application leaves `draft`, and never cleared afterwards.
 */
import type { ApplicationStatus } from '../types.ts';

/** Board order, and the order the status picker offers. */
export const APPLICATION_STATUSES = [
  'draft',
  'applied',
  'interviewing',
  'offered',
  'rejected',
] as const satisfies readonly ApplicationStatus[];

const LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
};

export function statusLabel(status: ApplicationStatus): string {
  return LABELS[status];
}

/** True once anything has been sent — i.e. every status except `draft`. */
export function hasBeenSent(status: ApplicationStatus): boolean {
  return status !== 'draft';
}

/**
 * The `applied_at` a row should carry after a status change.
 *
 * Moving out of `draft` for the first time stamps it; every later move keeps
 * whatever is already there. Moving *back* to `draft` keeps it too — the date
 * something was sent is a fact, and un-setting it would quietly destroy the
 * only record of when that happened.
 */
export function nextAppliedAt(
  current: Date | null,
  nextStatus: ApplicationStatus,
  now: Date,
): Date | null {
  if (current !== null) return current;
  return hasBeenSent(nextStatus) ? now : null;
}
