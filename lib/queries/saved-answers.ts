/**
 * Saved answers: the answers Chris ticked "remember" on, for the agent to
 * link to the next form that asks (D-048).
 *
 * A root table, so every statement filters on `user_id` directly. Archived,
 * never deleted (D-011): unticking archives, and an archived one is gone
 * from every read here, which is what makes it a dead link.
 *
 * A leaf module on purpose, like `approvals.ts`: `application-questions.ts`
 * imports it, so it imports no other query module. The writers take the
 * caller's executor, so they commit or roll back with the question write
 * that caused them.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { decodeAnswer } from '../applications/questions.ts';
import { db, type Executor } from '../db/index.ts';
import { savedAnswer } from '../db/schema.ts';
import type { AnswerMode, QuestionKind, SavedAnswer } from '../types.ts';

type SavedAnswerRow = typeof savedAnswer.$inferSelect;

function toWire(row: SavedAnswerRow): SavedAnswer {
  return {
    id: row.id,
    prompt: row.prompt,
    kind: row.kind,
    answerMode: row.answerMode,
    // The column is not null, so neither is its decoding.
    answer: decodeAnswer(row.kind, row.answerMode, row.answer)!,
  };
}

/** What a saved answer is made from: a question's answer, already encoded
 *  as `application_question.answer` stores it. */
export interface SavedAnswerValues {
  prompt: string;
  kind: QuestionKind;
  answerMode: AnswerMode;
  answer: string;
}

/** Every one the caller has not archived, oldest first. */
export async function listSavedAnswers(userId: string): Promise<SavedAnswer[]> {
  const rows = await db
    .select()
    .from(savedAnswer)
    .where(and(eq(savedAnswer.userId, userId), eq(savedAnswer.isArchived, false)))
    // created_at ties within one transaction; the id breaks it (D-030).
    .orderBy(asc(savedAnswer.createdAt), asc(savedAnswer.id));
  return rows.map(toWire);
}

/** The ones among `ids` that are the caller's and not archived. Any other
 *  id, another user's included, is simply absent. */
export async function liveSavedAnswers(
  executor: Executor,
  userId: string,
  ids: readonly string[],
): Promise<SavedAnswer[]> {
  if (ids.length === 0) return [];
  const rows = await executor
    .select()
    .from(savedAnswer)
    .where(
      and(
        inArray(savedAnswer.id, [...new Set(ids)]),
        eq(savedAnswer.userId, userId),
        eq(savedAnswer.isArchived, false),
      ),
    );
  return rows.map(toWire);
}

export async function insertSavedAnswer(
  executor: Executor,
  userId: string,
  values: SavedAnswerValues,
): Promise<SavedAnswer> {
  const [row] = await executor
    .insert(savedAnswer)
    .values({ ...values, userId })
    .returning();
  if (!row) throw new Error('failed to insert a saved answer');
  return toWire(row);
}

/** The answer and its mode; the prompt stays as it was first saved. Only a
 *  live one is written: an archived one stays as it was retired. */
export async function updateSavedAnswer(
  executor: Executor,
  userId: string,
  id: string,
  values: Pick<SavedAnswerValues, 'answer' | 'answerMode'>,
): Promise<void> {
  await executor
    .update(savedAnswer)
    .set(values)
    .where(
      and(
        eq(savedAnswer.id, id),
        eq(savedAnswer.userId, userId),
        eq(savedAnswer.isArchived, false),
      ),
    );
}

export async function archiveSavedAnswer(
  executor: Executor,
  userId: string,
  id: string,
): Promise<void> {
  await executor
    .update(savedAnswer)
    .set({ isArchived: true })
    .where(and(eq(savedAnswer.id, id), eq(savedAnswer.userId, userId)));
}
