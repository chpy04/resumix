/**
 * The review flow's rules: what can be approved when, what an edit after
 * approval undoes, and which steps the review page shows. Pure, like
 * `status.ts` and `board.ts` — the query layer, the routes and the page all
 * ask these functions rather than restating them (D-044).
 *
 * Approval is per section (C11). The resume and the cover letter are each
 * stamped when Chris approves them, and the final approval stamps
 * `approved_at` and moves the application to `ready`. Changing a section
 * afterwards clears that section's stamp, and a `ready` application goes
 * back to `needs_review` (C3). Only this application's own writes count:
 * a library or template edit made elsewhere reopens nothing (C6).
 */
import { statusLabel } from './status.ts';
import type { ApplicationDetail, ApplicationStatus } from '../types.ts';

/** A part of the application Chris approves on its own. */
export type ReviewSection = 'resume' | 'coverLetter';

/** What the gates read. Timestamps are `Date` on a DB row and ISO strings on
 *  an `ApplicationDetail`; only their presence matters here, so both fit. */
export interface FinalApprovalState {
  status: ApplicationStatus;
  resumeId: string | null;
  resumeApprovedAt: Date | string | null;
  coverLetterId: string | null;
  coverLetterApprovedAt: Date | string | null;
  /** Bullet suggestions still waiting on Chris (D-045): counted by the query
   *  layer on the server, from `bulletSuggestions` on the page. */
  pendingSuggestions: number;
}

export interface ReviewState extends FinalApprovalState {
  approvedAt: Date | string | null;
}

/** What the review page's rules read, from the detail it holds. */
export function reviewStateOf(detail: ApplicationDetail): ReviewState {
  return {
    ...detail,
    pendingSuggestions: detail.bulletSuggestions.filter((s) => s.status === 'pending').length,
  };
}

function notInReview(status: ApplicationStatus): string | null {
  if (status === 'needs_review') return null;
  return `Only an application in Needs review can be approved; this one is ${statusLabel(status)}.`;
}

/** A pending suggestion is laid over the resume's preview, so approving the
 *  resume with one would approve text it may never send (D-045). */
function suggestionsPending(count: number): string | null {
  if (count === 0) return null;
  if (count === 1) return 'Apply or reject the bullet suggestion first.';
  return `Apply or reject the ${count} bullet suggestions first.`;
}

/**
 * Everything final approval requires, one check per line. Each answers
 * `null` when it passes or the sentence to show when it does not.
 *
 * Grouped by the step each check belongs to, in step order, rather than
 * appended: a later step's check goes after its own step's group, so two
 * tickets adding checks for different steps edit different lines.
 */
export const FINAL_APPROVAL_CHECKS: readonly ((s: FinalApprovalState) => string | null)[] = [
  (s) => notInReview(s.status),
  // Step 1: the resume.
  (s) => (s.resumeId ? null : 'This application has no resume; link one first.'),
  (s) => (s.resumeId === null || s.resumeApprovedAt !== null ? null : 'Approve the resume first.'),
  (s) => suggestionsPending(s.pendingSuggestions),
  // Step 2: the cover letter, which exists only when one is linked (C12).
  (s) =>
    s.coverLetterId === null || s.coverLetterApprovedAt !== null
      ? null
      : 'Approve the cover letter first.',
];

/** Why final approval is refused, or `[]` when it is not. */
export function finalApprovalProblems(s: FinalApprovalState): string[] {
  return FINAL_APPROVAL_CHECKS.flatMap((check) => check(s) ?? []);
}

/** Why approving one section is refused, or `null` when it is not. */
export function sectionApprovalProblem(
  s: FinalApprovalState,
  section: ReviewSection,
): string | null {
  const status = notInReview(s.status);
  if (status) return status;
  if (section === 'resume' && s.resumeId === null) {
    return 'This application has no resume to approve.';
  }
  if (section === 'resume') {
    const pending = suggestionsPending(s.pendingSuggestions);
    if (pending) return pending;
  }
  if (section === 'coverLetter' && s.coverLetterId === null) {
    return 'This application has no cover letter to approve.';
  }
  return null;
}

/** The statuses an edit can reopen. Earlier ones have nothing approved yet;
 *  sent ones are history, and their pinned snapshot is what went out (C6). */
export const REOPENABLE_STATUSES = [
  'needs_review',
  'ready',
] as const satisfies readonly ApplicationStatus[];

/** What a reopen reads: the status and the three stamps. */
export type ApprovalStamps = Pick<
  ReviewState,
  'status' | 'resumeApprovedAt' | 'coverLetterApprovedAt' | 'approvedAt'
>;

/** The columns a reopen writes: only the ones that change. */
export interface ReopenPatch {
  status?: 'needs_review';
  resumeApprovedAt?: null;
  coverLetterApprovedAt?: null;
  approvedAt?: null;
}

/**
 * What changing `section` does to an application's approval: that section's
 * stamp and the final one are cleared, and `ready` goes back to
 * `needs_review`. `null` when nothing would change.
 *
 * `approved_at` goes with it, so `ready` and a set `approved_at` stay the same
 * fact. The pinned snapshot is left alone until the next final approval
 * replaces it.
 */
export function reopenedApproval(row: ApprovalStamps, section: ReviewSection): ReopenPatch | null {
  if (!(REOPENABLE_STATUSES as readonly ApplicationStatus[]).includes(row.status)) return null;

  const patch: ReopenPatch = {};
  if (row.status === 'ready') patch.status = 'needs_review';
  if (section === 'resume' && row.resumeApprovedAt !== null) patch.resumeApprovedAt = null;
  if (section === 'coverLetter' && row.coverLetterApprovedAt !== null) {
    patch.coverLetterApprovedAt = null;
  }
  if (row.approvedAt !== null) patch.approvedAt = null;

  return Object.keys(patch).length > 0 ? patch : null;
}

export type ReviewStepKey = ReviewSection | 'approve';

export interface ReviewStep {
  key: ReviewStepKey;
  /** 1-based and contiguous: with no letter, Approve is step 2. */
  number: number;
  label: string;
  done: boolean;
}

/** The review page's stepper, in order. The cover letter step exists only
 *  when a letter is linked (C12); a questions step slots in before Approve. */
export function reviewSteps(s: ReviewState): ReviewStep[] {
  const steps: Omit<ReviewStep, 'number'>[] = [
    { key: 'resume', label: 'Resume', done: s.resumeApprovedAt !== null },
    ...(s.coverLetterId === null
      ? []
      : [
          {
            key: 'coverLetter' as const,
            label: 'Cover letter',
            done: s.coverLetterApprovedAt !== null,
          },
        ]),
    { key: 'approve', label: 'Approve', done: s.approvedAt !== null },
  ];
  return steps.map((step, index) => ({ ...step, number: index + 1 }));
}

/** Where the page opens: the first step still to do, or Approve once all are. */
export function initialStep(steps: readonly ReviewStep[]): ReviewStepKey {
  return (steps.find((step) => !step.done) ?? steps[steps.length - 1])?.key ?? 'resume';
}

/** What Chris pastes into the agent workspace. The full id, because the
 *  tools take a `z.uuid()`. */
export function applyCommand(applicationId: string): string {
  return `/resumix-apply ${applicationId}`;
}

/** The sections that were approved in `before` and are not in `after`: an
 *  edit has just reopened them, which the page says next to the button. */
export function reopenedSections(
  before: Pick<ReviewState, 'resumeApprovedAt' | 'coverLetterApprovedAt'>,
  after: Pick<ReviewState, 'resumeApprovedAt' | 'coverLetterApprovedAt'>,
): ReviewSection[] {
  const sections: ReviewSection[] = [];
  if (before.resumeApprovedAt !== null && after.resumeApprovedAt === null) sections.push('resume');
  if (before.coverLetterApprovedAt !== null && after.coverLetterApprovedAt === null) {
    sections.push('coverLetter');
  }
  return sections;
}

/**
 * Why a new resume PDF may not be pinned to an application in `status`, or
 * null when it may. A Ready application's pinned PDF is the one final
 * approval stored, and only another final approval replaces it (C4).
 */
export function repinRefusal(status: ApplicationStatus): string | null {
  if (status !== 'ready') return null;
  return (
    "This application is Ready: its PDF is the one you approved, so a new one can't replace " +
    'it. Edit the resume to send it back to review, then approve it again.'
  );
}
