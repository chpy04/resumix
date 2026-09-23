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
 * clone. Copying one is copying a string (D-035).
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { coverLetter } from '../db/schema.ts';
import { DEFAULT_COVER_LETTER } from '../render/default-cover-letter.ts';
import type { CoverLetter, CoverLetterSummary } from '../types.ts';
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
  return { ...toSummary(row), content: row.content };
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
 * wrote in the default is exactly what lands in the new row, and editing it
 * for the job is the next thing you do by hand (D-035).
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
 */
export async function updateCoverLetter(
  userId: string,
  id: string,
  patch: { name?: string; content?: string; isArchived?: boolean },
): Promise<CoverLetter> {
  if (patch.isArchived === true) {
    const existing = await getCoverLetterRow(userId, id);
    if (!existing) throw new NotFoundError(`cover letter ${id} not found`);
    // Archiving the default would leave new letters with nothing to copy.
    if (existing.isDefault) {
      throw new BadRequestError('the default cover letter cannot be archived');
    }
  }

  const [row] = await db
    .update(coverLetter)
    .set(patch)
    .where(and(eq(coverLetter.id, id), eq(coverLetter.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`cover letter ${id} not found`);

  return toWire(row);
}
