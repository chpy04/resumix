/**
 * Reopening an approval when what it approved changes (C3, D-044).
 *
 * Called from the writers that change what an application sends, and from
 * nowhere else: `replaceSelections` (the resume's selection: editor autosave,
 * cloning, and the agent's `set_resume_selection`), `updateCoverLetter` when
 * the letter's text changes, and the relinks in `applications.ts`. Library
 * and template edits never come through here, because a global edit made
 * elsewhere must not reopen anything (C6).
 *
 * There is no diffing: any write reopens, even one that restores what was
 * there. Each function takes the caller's executor, so the reopen commits or
 * rolls back with the write that caused it.
 *
 * A leaf module on purpose: `selections.ts` and `cover-letters.ts` import it,
 * and `applications.ts` imports both of those, so it cannot live there.
 */
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import {
  REOPENABLE_STATUSES,
  reopenedApproval,
  type ReviewSection,
} from '../applications/review.ts';
import type { Executor } from '../db/index.ts';
import { application } from '../db/schema.ts';

/** Clears `section`'s approval on every one of the caller's applications
 *  that `where` matches and that has something to clear. */
async function reopenWhere(
  executor: Executor,
  userId: string,
  where: SQL | undefined,
  section: ReviewSection,
): Promise<void> {
  const rows = await executor
    .select({
      id: application.id,
      status: application.status,
      resumeApprovedAt: application.resumeApprovedAt,
      coverLetterApprovedAt: application.coverLetterApprovedAt,
      approvedAt: application.approvedAt,
    })
    .from(application)
    .where(
      and(
        eq(application.userId, userId),
        inArray(application.status, [...REOPENABLE_STATUSES]),
        where,
      ),
    )
    // Locked, because the patch is computed from what this reads. A final
    // approval in flight holds the row; without the lock this would read it
    // as it was before (Needs review, nothing to clear but the resume's
    // stamp), wait only at the UPDATE, and then clear that one stamp on a
    // row that is now `ready`, leaving `approved_at` set. With it, the read
    // waits for the approval to commit and sees `ready`.
    .for('update');

  for (const row of rows) {
    const patch = reopenedApproval(row, section);
    if (patch) await executor.update(application).set(patch).where(eq(application.id, row.id));
  }
}

/** A write to this resume's selection. Another user's application pointing
 *  at the same id is never touched: the filter is on the caller. */
export function reopenForResume(
  executor: Executor,
  userId: string,
  resumeId: string,
): Promise<void> {
  return reopenWhere(executor, userId, eq(application.resumeId, resumeId), 'resume');
}

/** A write to this letter's text. */
export function reopenForCoverLetter(
  executor: Executor,
  userId: string,
  coverLetterId: string,
): Promise<void> {
  return reopenWhere(executor, userId, eq(application.coverLetterId, coverLetterId), 'coverLetter');
}

/**
 * One application whose resume or letter now points somewhere else,
 * unlinking included: what was approved is no longer what it sends. Run
 * after the relink is written, so a status set in the same PATCH wins over
 * the reopen.
 */
export async function reopenRelinked(
  executor: Executor,
  userId: string,
  applicationId: string,
  sections: readonly ReviewSection[],
): Promise<void> {
  // One at a time: each reads the row the previous one wrote.
  for (const section of sections) {
    await reopenWhere(executor, userId, eq(application.id, applicationId), section);
  }
}
