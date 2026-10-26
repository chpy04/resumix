/**
 * The application status vocabulary, and the rules that govern moving
 * between values. Pure and framework-free — the query layer, the zod schema
 * and the UI all read the vocabulary from here rather than restating it.
 *
 * The statuses split in two (D-041). The **flow** statuses — `proposing`,
 * `needs_review`, `ready` — belong to the agent's review flow: only it moves
 * an application into them, because `ready` vouches for approvals and a
 * snapshot that a hand-set status would skip. The **manual** statuses are the
 * rest, and among those there is no transition graph: any can follow any
 * other, because real applications do not proceed tidily (a recruiter
 * reopens a rejection; you realise you never actually sent the thing).
 *
 * The rule that *is* enforced everywhere is `appliedAt`: it is set the first
 * time an application reaches `applied` or a later stage, and never cleared.
 * Leaving `draft` is no longer enough — an application the agent is still
 * proposing has not been sent anywhere.
 */
import type { ApplicationStatus } from '../types.ts';

/** The order an application moves through — also the enum's own order in
 *  Postgres (drizzle/0007_application_pipeline.sql). */
export const APPLICATION_STATUSES = [
  'draft',
  'proposing',
  'needs_review',
  'ready',
  'applied',
  'interviewing',
  'offered',
  'rejected',
] as const satisfies readonly ApplicationStatus[];

/** Set only by the review flow. The API refuses them in a PATCH, and the
 *  board does not accept them as drop targets (C3). */
export const FLOW_STATUSES = [
  'proposing',
  'needs_review',
  'ready',
] as const satisfies readonly ApplicationStatus[];

/** What a person may set by hand: the status picker, the Applied table's
 *  select, a drop on the board, and `PATCH /api/applications/:id`. */
export const MANUAL_STATUSES = [
  'draft',
  'applied',
  'interviewing',
  'offered',
  'rejected',
] as const satisfies readonly ApplicationStatus[];

export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export function isFlowStatus(status: ApplicationStatus): boolean {
  return (FLOW_STATUSES as readonly ApplicationStatus[]).includes(status);
}

const LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  proposing: 'Proposing',
  needs_review: 'Needs review',
  ready: 'Ready',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offered: 'Offered',
  rejected: 'Rejected',
};

export function statusLabel(status: ApplicationStatus): string {
  return LABELS[status];
}

/** `applied` and everything that can only come after something was sent.
 *  `rejected` is here even though a rejection can arrive for something never
 *  sent: logging one is still the moment the application ended (D-041). */
const SENT_STATUSES: readonly ApplicationStatus[] = [
  'applied',
  'interviewing',
  'offered',
  'rejected',
];

/** True once something has been sent — never for `draft` or a flow status. */
export function hasBeenSent(status: ApplicationStatus): boolean {
  return SENT_STATUSES.includes(status);
}

/**
 * The `applied_at` a row should carry after a status change.
 *
 * Reaching a sent status for the first time stamps it, including one that
 * skips straight past `applied`; every later move keeps whatever is already
 * there. Moving *back* to `draft` keeps it too — the date something was sent
 * is a fact, and un-setting it would quietly destroy the only record of when
 * that happened.
 */
export function nextAppliedAt(
  current: Date | null,
  nextStatus: ApplicationStatus,
  now: Date,
): Date | null {
  if (current !== null) return current;
  return hasBeenSent(nextStatus) ? now : null;
}
