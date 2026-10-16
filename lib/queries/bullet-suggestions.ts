/**
 * Bullet suggestions: what the agent would change about the bullets on one
 * application's resume, and what Chris does with each in review (D-045), or
 * on one of his resumes outside any application, and what he does with each
 * in its editor (D-054).
 *
 * The agent never writes to the library (D11, R2). `createBulletSuggestion`
 * and `createResumeSuggestion` only record the proposal; the library and the
 * selection change only in `resolveBulletSuggestion`, which is Chris's click.
 *
 * A suggestion has no `user_id` of its own; it belongs to whoever owns its
 * application or its resume, exactly one of which it names
 * (docs/SCHEMA.md), so every function here resolves that through a join, as
 * `application-files.ts` does. Its `bullet_id` and `parent_id` point into one
 * of two tables each, with no foreign key, so every use goes back through the
 * user-scoped bullet queries, which re-check ownership.
 */
import { and, asc, count, eq, inArray, or } from 'drizzle-orm';
import { suggestionsLocked } from '../applications/suggestions.ts';
import { db, type Executor } from '../db/index.ts';
import {
  application,
  bulletSuggestion,
  experience,
  experienceBullet,
  project,
  projectBullet,
  resume,
} from '../db/schema.ts';
import { escapeLatex } from '../render/escape.ts';
import { insertAt, swapIn } from '../render/suggestions.ts';
import type { BulletSuggestion, BulletSuggestionAction } from '../types.ts';
import { BadRequestError, NotFoundError } from './errors.ts';
import { createExperienceBullet, updateExperienceBullet } from './experience-bullets.ts';
import { createProjectBullet, updateProjectBullet } from './project-bullets.ts';
import { getSelections, replaceSelections } from './selections.ts';

type SuggestionRow = typeof bulletSuggestion.$inferSelect;

/** What the agent proposes; the server has already resolved `bulletKind`
 *  from the id it named. */
export type NewBulletSuggestion =
  | {
      kind: 'edit';
      bulletKind: BulletSuggestion['bulletKind'];
      bulletId: string;
      proposedText: string;
      rationale: string;
    }
  | {
      kind: 'add';
      bulletKind: BulletSuggestion['bulletKind'];
      parentId: string;
      position: number;
      proposedText: string;
      rationale: string;
    };

const RESOLVED_STATUS = {
  apply: 'applied',
  copy: 'copied',
  reject: 'rejected',
} as const satisfies Record<BulletSuggestionAction, BulletSuggestion['status']>;

function toWire(row: SuggestionRow): BulletSuggestion {
  return {
    id: row.id,
    kind: row.kind,
    bulletKind: row.bulletKind,
    bulletId: row.bulletId,
    parentId: row.parentId,
    position: row.position,
    proposedText: row.proposedText,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

type ApplicationStatus = typeof application.$inferSelect.status;

/** The caller's applications, or only those in `status`, as the subquery a
 *  suggestion's owner is checked against in a guarded write. */
function ownedApplicationIds(exec: Executor, userId: string, status?: ApplicationStatus) {
  return exec
    .select({ id: application.id })
    .from(application)
    .where(
      and(eq(application.userId, userId), status ? eq(application.status, status) : undefined),
    );
}

/** The caller's resumes, as the subquery a resume-scoped suggestion's owner
 *  is checked against in a guarded write. */
function ownedResumeIds(exec: Executor, userId: string) {
  return exec.select({ id: resume.id }).from(resume).where(eq(resume.userId, userId));
}

/** Every suggestion on one of the caller's applications, resolved ones
 *  included, oldest first. Another user's application has none. */
export async function listBulletSuggestions(
  userId: string,
  applicationId: string,
): Promise<BulletSuggestion[]> {
  const rows = await db
    .select({ suggestion: bulletSuggestion })
    .from(bulletSuggestion)
    .innerJoin(application, eq(bulletSuggestion.applicationId, application.id))
    .where(and(eq(bulletSuggestion.applicationId, applicationId), eq(application.userId, userId)))
    // The id breaks the tie; created_at is not unique (D-030).
    .orderBy(asc(bulletSuggestion.createdAt), asc(bulletSuggestion.id));
  return rows.map((row) => toWire(row.suggestion));
}

/** How many are still waiting on Chris, which final approval and resume
 *  approval refuse while it is above zero. */
export async function countPendingSuggestions(
  userId: string,
  applicationId: string,
): Promise<number> {
  const [row] = await db
    .select({ pending: count() })
    .from(bulletSuggestion)
    .innerJoin(application, eq(bulletSuggestion.applicationId, application.id))
    .where(
      and(
        eq(bulletSuggestion.applicationId, applicationId),
        eq(application.userId, userId),
        eq(bulletSuggestion.status, 'pending'),
      ),
    );
  return row?.pending ?? 0;
}

/**
 * The pending suggestions the review preview lays over this resume. The
 * application must be the caller's and send this resume; anything else is
 * not found, so a preview can never borrow another application's, or
 * another user's, suggestions.
 */
export async function previewSuggestions(
  userId: string,
  applicationId: string,
  resumeId: string,
): Promise<BulletSuggestion[]> {
  const [row] = await db
    .select({ id: application.id })
    .from(application)
    .where(
      and(
        eq(application.id, applicationId),
        eq(application.userId, userId),
        eq(application.resumeId, resumeId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError(`application ${applicationId} not found for this resume`);
  const suggestions = await listBulletSuggestions(userId, applicationId);
  return suggestions.filter((s) => s.status === 'pending');
}

/** Every suggestion made on one of the caller's resumes outside an
 *  application, resolved ones included, oldest first (D-054). Another user's
 *  resume has none. */
export async function listResumeSuggestions(
  userId: string,
  resumeId: string,
): Promise<BulletSuggestion[]> {
  const rows = await db
    .select({ suggestion: bulletSuggestion })
    .from(bulletSuggestion)
    .innerJoin(resume, eq(bulletSuggestion.resumeId, resume.id))
    .where(and(eq(bulletSuggestion.resumeId, resumeId), eq(resume.userId, userId)))
    .orderBy(asc(bulletSuggestion.createdAt), asc(bulletSuggestion.id));
  return rows.map((row) => toWire(row.suggestion));
}

/** The ones still waiting on Chris: what the editor shows as cards and lays
 *  over its preview. */
export async function pendingResumeSuggestions(
  userId: string,
  resumeId: string,
): Promise<BulletSuggestion[]> {
  const suggestions = await listResumeSuggestions(userId, resumeId);
  return suggestions.filter((s) => s.status === 'pending');
}

/**
 * Records a suggestion, and nothing else: no bullet and no selection is
 * written. Only while the application is `proposing`, which the row lock
 * makes hold until this commits.
 *
 * A second edit of a bullet that already has a pending edit replaces that
 * one's text and rationale rather than stacking a second card on it, which
 * the partial unique index would refuse anyway. It is safe because pending
 * edits exist only while the agent is still proposing: Chris has not seen
 * them yet. `replaced` says which happened.
 */
export async function createBulletSuggestion(
  userId: string,
  applicationId: string,
  input: NewBulletSuggestion,
): Promise<{ suggestion: BulletSuggestion; replaced: boolean }> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ status: application.status })
      .from(application)
      .where(and(eq(application.id, applicationId), eq(application.userId, userId)))
      .for('update');
    if (!owner) throw new NotFoundError(`application ${applicationId} not found`);
    if (owner.status !== 'proposing') {
      throw new BadRequestError(
        `This application is ${owner.status}; suggestions can only be made while it is proposing.`,
      );
    }

    return recordSuggestion(tx, { applicationId }, input);
  });
}

/**
 * Records a suggestion on one of the caller's resumes, outside any
 * application, and nothing else (D-054). Refused for a resume an application
 * uses, whose suggestions go through that application's review instead.
 *
 * A second edit of a bullet with a pending edit replaces it, as above. Here
 * Chris may already have reworded the pending one; the agent is told that it
 * replaces it, Chris's wording included, because a second edit is what he
 * asks for when the first did not read right.
 */
export async function createResumeSuggestion(
  userId: string,
  resumeId: string,
  input: NewBulletSuggestion,
): Promise<{ suggestion: BulletSuggestion; replaced: boolean }> {
  return db.transaction(async (tx) => {
    // The lock holds off a second call's replace-or-insert until this one
    // commits, as the application's row lock does above.
    const [owner] = await tx
      .select({ id: resume.id })
      .from(resume)
      .where(and(eq(resume.id, resumeId), eq(resume.userId, userId)))
      .for('update');
    if (!owner) throw new NotFoundError(`resume ${resumeId} not found`);
    const [usedBy] = await tx
      .select({ id: application.id })
      .from(application)
      .where(and(eq(application.resumeId, resumeId), eq(application.userId, userId)))
      .limit(1);
    if (usedBy) {
      throw new BadRequestError(
        `Resume ${resumeId} is application ${usedBy.id}'s; suggest through that application.`,
      );
    }
    return recordSuggestion(tx, { resumeId }, input);
  });
}

/** The write both creates share: replace the bullet's pending edit, or
 *  insert. `owner` is the one column the row names its owner by. */
async function recordSuggestion(
  tx: Executor,
  owner: { applicationId: string } | { resumeId: string },
  input: NewBulletSuggestion,
): Promise<{ suggestion: BulletSuggestion; replaced: boolean }> {
  const ownedBy =
    'applicationId' in owner
      ? eq(bulletSuggestion.applicationId, owner.applicationId)
      : eq(bulletSuggestion.resumeId, owner.resumeId);

  if (input.kind === 'edit') {
    const [replaced] = await tx
      .update(bulletSuggestion)
      .set({ proposedText: input.proposedText, rationale: input.rationale })
      .where(
        and(
          ownedBy,
          eq(bulletSuggestion.bulletId, input.bulletId),
          eq(bulletSuggestion.status, 'pending'),
        ),
      )
      .returning();
    if (replaced) return { suggestion: toWire(replaced), replaced: true };
  }

  const [row] = await tx
    .insert(bulletSuggestion)
    .values(
      input.kind === 'edit'
        ? {
            ...owner,
            kind: 'edit',
            bulletKind: input.bulletKind,
            bulletId: input.bulletId,
            proposedText: input.proposedText,
            rationale: input.rationale,
          }
        : {
            ...owner,
            kind: 'add',
            bulletKind: input.bulletKind,
            parentId: input.parentId,
            position: input.position,
            proposedText: input.proposedText,
            rationale: input.rationale,
          },
    )
    .returning();
  if (!row) throw new Error('failed to store bullet suggestion');
  return { suggestion: toWire(row), replaced: false };
}

/** A suggestion the caller owns, through its application, or through its
 *  resume. With `inReview`, an application's counts only while it is in
 *  Needs review; a resume's has no such status and always counts. */
function ownedSuggestion(exec: Executor, userId: string, inReview = false) {
  return or(
    inArray(
      bulletSuggestion.applicationId,
      ownedApplicationIds(exec, userId, inReview ? 'needs_review' : undefined),
    ),
    inArray(bulletSuggestion.resumeId, ownedResumeIds(exec, userId)),
  );
}

/** Why a guarded write on suggestion `id` matched nothing: it is missing (or
 *  someone else's), or it has been resolved, or its application has left
 *  review. Read after the fact, only to word the error. */
async function refusal(exec: Executor, userId: string, id: string): Promise<Error> {
  const [row] = await exec
    .select({ status: bulletSuggestion.status, applicationStatus: application.status })
    .from(bulletSuggestion)
    .leftJoin(application, eq(bulletSuggestion.applicationId, application.id))
    .leftJoin(resume, eq(bulletSuggestion.resumeId, resume.id))
    .where(
      and(
        eq(bulletSuggestion.id, id),
        or(eq(application.userId, userId), eq(resume.userId, userId)),
      ),
    )
    .limit(1);
  if (!row) return new NotFoundError(`bullet suggestion ${id} not found`);
  if (row.status !== 'pending') return new BadRequestError(alreadyResolved(row.status));
  // A resume's suggestion has no status of its own to refuse on, so only a
  // write racing this one gets here.
  if (!row.applicationStatus) return new BadRequestError('This suggestion changed; try again.');
  return new BadRequestError(notInReview(row.applicationStatus));
}

const RESOLVED_AS: Record<Exclude<BulletSuggestion['status'], 'pending'>, string> = {
  applied: 'applied',
  copied: 'saved as a new bullet',
  rejected: 'rejected',
};

function alreadyResolved(status: Exclude<BulletSuggestion['status'], 'pending'>): string {
  return `This suggestion was already ${RESOLVED_AS[status]}.`;
}

function notInReview(status: ApplicationStatus): string {
  return suggestionsLocked(status) ?? `This application changed; try again.`;
}

/**
 * Chris's edit to a pending suggestion's text, autosaved: the preview and
 * the action then use what he typed. The agent's own wording is not kept
 * beside it (D-045). An application's only while it is in review; a
 * resume's whenever it is pending (D-054).
 */
export async function updateBulletSuggestionText(
  userId: string,
  id: string,
  proposedText: string,
): Promise<BulletSuggestion> {
  const [row] = await db
    .update(bulletSuggestion)
    .set({ proposedText })
    .where(
      and(
        eq(bulletSuggestion.id, id),
        eq(bulletSuggestion.status, 'pending'),
        ownedSuggestion(db, userId, true),
      ),
    )
    .returning();
  if (row) return toWire(row);
  throw await refusal(db, userId, id);
}

/** The experience or project an edited bullet sits under, scoped to its
 *  owner, for Save as new. */
async function parentOf(
  exec: Executor,
  userId: string,
  kind: BulletSuggestion['bulletKind'],
  bulletId: string,
): Promise<string> {
  const [row] =
    kind === 'experience'
      ? await exec
          .select({ parentId: experienceBullet.experienceId })
          .from(experienceBullet)
          .innerJoin(experience, eq(experienceBullet.experienceId, experience.id))
          .where(and(eq(experienceBullet.id, bulletId), eq(experience.userId, userId)))
          .limit(1)
      : await exec
          .select({ parentId: projectBullet.projectId })
          .from(projectBullet)
          .innerJoin(project, eq(projectBullet.projectId, project.id))
          .where(and(eq(projectBullet.id, bulletId), eq(project.userId, userId)))
          .limit(1);
  if (!row) throw new NotFoundError(`${kind} bullet ${bulletId} not found`);
  return row.parentId;
}

/** Puts `bulletId` into the resume's list for `parentId`, through
 *  `replaceSelections`: the same write the editor makes, so it re-checks
 *  ownership and reopens an approved resume the same way (D-044). */
async function writeBulletOrder(
  tx: Executor,
  userId: string,
  resumeId: string,
  kind: BulletSuggestion['bulletKind'],
  parentId: string,
  order: (current: string[]) => string[],
): Promise<void> {
  const slice = kind === 'experience' ? 'experienceBullets' : 'projectBullets';
  const current = (await getSelections(resumeId, tx))[slice];
  await replaceSelections(
    userId,
    resumeId,
    { [slice]: { ...current, [parentId]: order(current[parentId] ?? []) } },
    tx,
  );
}

/**
 * Chris resolves one suggestion, in one transaction, on the resume it is
 * for: its application's, which must be in Needs review, or its own (D-054).
 *
 * - **apply** an edit: the library bullet's content becomes the escaped
 *   text. A global edit, like any edit to a bullet, so every resume that
 *   shows it changes, and no other application reopens (C6).
 * - **copy** an edit (Save as new): a sibling bullet with the text, swapped
 *   into this resume where the original was. The original is untouched.
 * - **apply** an addition (Add bullet): a new bullet under its parent,
 *   selected at its position.
 * - **reject**: the status, and nothing else.
 *
 * The status moves first, guarded on `pending` and the owner, so a double
 * click resolves once and another user's id is not found. Anything refused
 * after that throws and rolls the status back with it.
 */
export async function resolveBulletSuggestion(
  userId: string,
  id: string,
  action: BulletSuggestionAction,
): Promise<BulletSuggestion> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(bulletSuggestion)
      .set({ status: RESOLVED_STATUS[action] })
      .where(
        and(
          eq(bulletSuggestion.id, id),
          eq(bulletSuggestion.status, 'pending'),
          ownedSuggestion(tx, userId),
        ),
      )
      .returning();
    if (!row) throw await refusal(tx, userId, id);

    const resumeId = row.applicationId
      ? await reviewedResume(tx, userId, id, row.applicationId)
      : row.resumeId;
    // The CHECK makes this unreachable: a row names one owner or the other.
    if (!resumeId) throw new Error(`bullet suggestion ${id} has no owner`);
    if (action === 'copy' && row.kind === 'add') {
      throw new BadRequestError('An addition is already a new bullet; use Add bullet.');
    }
    if (action === 'reject') return toWire(row);

    const text = escapeLatex(row.proposedText);
    const isExperience = row.bulletKind === 'experience';
    const create = isExperience ? createExperienceBullet : createProjectBullet;

    if (row.kind === 'add') {
      if (!row.parentId || row.position === null) throw new Error(`addition ${id} has no slot`);
      const created = await create(userId, row.parentId, text, tx);
      const position = row.position;
      await writeBulletOrder(tx, userId, resumeId, row.bulletKind, row.parentId, (ids) =>
        insertAt(ids, created.id, position),
      );
      return toWire(row);
    }

    const bulletId = row.bulletId;
    if (!bulletId) throw new Error(`edit ${id} names no bullet`);
    if (action === 'apply') {
      const update = isExperience ? updateExperienceBullet : updateProjectBullet;
      await update(userId, bulletId, { content: text }, tx);
      return toWire(row);
    }

    const parentId = await parentOf(tx, userId, row.bulletKind, bulletId);
    const created = await create(userId, parentId, text, tx);
    await writeBulletOrder(tx, userId, resumeId, row.bulletKind, parentId, (ids) =>
      swapIn(ids, bulletId, created.id),
    );
    return toWire(row);
  });
}

/** The resume an application's suggestion resolves onto, once the
 *  application is in review and sends one. */
async function reviewedResume(
  tx: Executor,
  userId: string,
  id: string,
  applicationId: string,
): Promise<string> {
  const [owner] = await tx
    .select({ status: application.status, resumeId: application.resumeId })
    .from(application)
    .where(and(eq(application.id, applicationId), eq(application.userId, userId)));
  if (!owner) throw new NotFoundError(`bullet suggestion ${id} not found`);
  if (owner.status !== 'needs_review') throw new BadRequestError(notInReview(owner.status));
  if (!owner.resumeId) {
    throw new BadRequestError('This application has no resume to apply a suggestion to.');
  }
  return owner.resumeId;
}
