/**
 * Cover letters, always scoped to their owner.
 *
 * Same contract as every other query module: the caller's `userId` is the
 * first argument and every statement filters on it, so a cover letter id
 * belonging to someone else reads as "not found" rather than "forbidden"
 * (docs/API.md).
 *
 * Unlike a resume, a cover letter *is* its text — there is nothing to
 * assemble, so there is no `render.ts` counterpart and no bridge table to
 * clone. Copying one is copying its two strings (D-035, D-046).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, type Executor } from '../db/index.ts';
import { coverLetter } from '../db/schema.ts';
import { bodyMarkerProblem } from '../render/cover-letter.ts';
import { DEFAULT_COVER_LETTER } from '../render/default-cover-letter.ts';
import type { CoverLetter, CoverLetterSummary } from '../types.ts';
import { reopenForCoverLetter } from './approvals.ts';
import { BadRequestError, NotFoundError } from './errors.ts';

type CoverLetterRow = typeof coverLetter.$inferSelect;

function toSummary(row: CoverLetterRow): CoverLetterSummary {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWire(row: CoverLetterRow): CoverLetter {
  return { ...toSummary(row), content: row.content, body: row.body };
}

/** Default first, then newest — the same order the resume library uses, and
 *  for the same reason: the default is the one you reach for by name. */
export async function listCoverLetters(
  userId: string,
  includeArchived: boolean,
): Promise<CoverLetterSummary[]> {
  const rows = await db
    .select()
    .from(coverLetter)
    .where(
      includeArchived
        ? eq(coverLetter.userId, userId)
        : and(eq(coverLetter.userId, userId), eq(coverLetter.isArchived, false)),
    )
    // The id breaks the tie; created_at is not unique (D-030).
    .orderBy(desc(coverLetter.isDefault), desc(coverLetter.createdAt), desc(coverLetter.id));

  return rows.map(toSummary);
}

export async function getCoverLetterRow(
  userId: string,
  id: string,
): Promise<CoverLetterRow | null> {
  const [row] = await db
    .select()
    .from(coverLetter)
    .where(and(eq(coverLetter.id, id), eq(coverLetter.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getCoverLetter(userId: string, id: string): Promise<CoverLetter | null> {
  const row = await getCoverLetterRow(userId, id);
  return row ? toWire(row) : null;
}

/** The letter new ones are copied from. Every account is provisioned with
 *  one (`provisionUser`), so this is null only for a hand-broken database. */
export async function getDefaultCoverLetter(userId: string): Promise<CoverLetterRow | null> {
  const [row] = await db
    .select()
    .from(coverLetter)
    .where(and(eq(coverLetter.userId, userId), eq(coverLetter.isDefault, true)))
    // Tie-broken for the same reason every other order is (D-030); the
    // partial unique index makes a second row impossible, not merely rare.
    .orderBy(asc(coverLetter.createdAt), asc(coverLetter.id))
    .limit(1);
  return row ?? null;
}

/**
 * Copies a cover letter under a new name — the whole of "add a cover letter
 * to this application".
 *
 * `sourceId` defaults to this user's default letter. The copy is literal:
 * no substitution, no tokens, nothing derived from the company. What you
 * wrote in the default, LaTeX and body alike, is exactly what lands in the
 * new row, and editing it for the job is the next thing you do (D-035).
 *
 * The copy is never itself the default. `is_default` is a partial unique
 * index, so carrying it across would fail the insert on the second letter.
 */
export async function createCoverLetter(
  userId: string,
  name: string,
  sourceId?: string | null,
): Promise<CoverLetter> {
  const source = sourceId
    ? await getCoverLetterRow(userId, sourceId)
    : await getDefaultCoverLetter(userId);

  if (sourceId && !source) {
    throw new BadRequestError(`unknown cover letter id: ${sourceId}`);
  }

  const [row] = await db
    .insert(coverLetter)
    .values({
      userId,
      name,
      // A user with no default letter still gets a usable one rather than a
      // blank document that cannot compile.
      content: source?.content ?? DEFAULT_COVER_LETTER,
      body: source?.body ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create cover letter');

  return toWire(row);
}

/**
 * Renames, rewrites or archives one letter.
 *
 * `isDefault` is deliberately not patchable: which letter is the default is
 * set once at provisioning, and flipping it would need the old default
 * cleared in the same transaction or the partial unique index rejects the
 * write. Nothing in the UI asks for it yet.
 *
 * A write to the text is refused when it would leave a body with anything
 * but exactly one `%%BODY%%` line to go to, whichever of the two columns it
 * changes. So a stored letter always renders, and a broken one is a `400`
 * at the keystroke that broke it rather than a compile error later (D-046).
 */
export async function updateCoverLetter(
  userId: string,
  id: string,
  patch: { name?: string; content?: string; body?: string; isArchived?: boolean },
): Promise<CoverLetter> {
  if (patch.isArchived === true) {
    const existing = await getCoverLetterRow(userId, id);
    if (!existing) throw new NotFoundError(`cover letter ${id} not found`);
    // Archiving the default would leave new letters with nothing to copy.
    if (existing.isDefault) {
      throw new BadRequestError('the default cover letter cannot be archived');
    }
  }

  async function write(executor: Executor): Promise<CoverLetterRow> {
    const [row] = await executor
      .update(coverLetter)
      .set(patch)
      .where(and(eq(coverLetter.id, id), eq(coverLetter.userId, userId)))
      .returning();
    if (!row) throw new NotFoundError(`cover letter ${id} not found`);
    return row;
  }

  // Only the text is what gets sent, so only `content` or `body` unapproves
  // the letter on an application in review; a rename or an archive leaves it
  // (D-044).
  if (patch.content === undefined && patch.body === undefined) return toWire(await write(db));
  return db.transaction(async (tx) => {
    // Locked, because the check reads the column the patch leaves alone. The
    // editor saves `content` and `body` on separate channels; unlocked, two
    // saves in flight could each pass against the other's old value and
    // together store a body with no marker.
    const [existing] = await tx
      .select()
      .from(coverLetter)
      .where(and(eq(coverLetter.id, id), eq(coverLetter.userId, userId)))
      .for('update');
    // Not found before any 400, so another user's id never learns its shape.
    if (!existing) throw new NotFoundError(`cover letter ${id} not found`);

    if ((patch.body ?? existing.body) !== null) {
      const problem = bodyMarkerProblem(patch.content ?? existing.content);
      if (problem) throw new BadRequestError(problem);
    }

    const row = await write(tx);
    await reopenForCoverLetter(tx, userId, id);
    return toWire(row);
  });
}
