/**
 * An application's questions: what its form asks, the answer proposed for
 * each, and Chris's approval of each one (D-047).
 *
 * An `application_question` has no `user_id` of its own; it belongs to
 * whoever owns its application (docs/SCHEMA.md), so every function here
 * resolves that through a join, as `application-files.ts` does.
 *
 * Every write takes its application's row lock first (`lockApplication`).
 * Final approval takes the same lock before it checks the questions, so an
 * answer edit and a final approval never interleave: whichever comes second
 * sees what the first committed (`recordFinalApproval`).
 *
 * C10 is enforced here as well as by a CHECK: a proposal on an EEO question
 * is dropped before it is written, whoever flagged it.
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  answerProblem,
  approvalProblem,
  canRedraft,
  decodeAnswer,
  decodeProposal,
  encodeAnswer,
  fieldKey,
  hasOptions,
  looksLikeEeo,
  normalizeFieldRef,
} from '../applications/questions.ts';
import { sectionApprovalProblem } from '../applications/review.ts';
import { hasBeenSent, statusLabel } from '../applications/status.ts';
import { db, type Executor } from '../db/index.ts';
import { application, applicationFile, applicationQuestion } from '../db/schema.ts';
import type {
  AnswerMode,
  AnswerValue,
  ApplicationQuestion,
  ApplicationStatus,
  QuestionKind,
} from '../types.ts';
import { reopenForQuestions } from './approvals.ts';
import { BadRequestError, NotFoundError } from './errors.ts';

type QuestionRow = typeof applicationQuestion.$inferSelect;

function toWire(row: QuestionRow): ApplicationQuestion {
  return {
    id: row.id,
    prompt: row.prompt,
    kind: row.kind,
    options: row.options,
    fieldRef: {
      page: row.fieldRef.page,
      label: row.fieldRef.label,
      selector: row.fieldRef.selector,
    },
    required: row.required,
    isEeo: row.isEeo,
    source: row.source,
    answerMode: row.answerMode,
    proposedAnswer: decodeProposal(row.kind, row.proposedAnswer),
    answer: decodeAnswer(row.kind, row.answerMode, row.answer),
    redraftNote: row.redraftNote,
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

/** `approvalProblem`'s view of a row: the answer decoded. */
function approvable(row: QuestionRow) {
  return {
    kind: row.kind,
    options: row.options,
    answerMode: row.answerMode,
    answer: decodeAnswer(row.kind, row.answerMode, row.answer),
  };
}

/**
 * The caller's application, locked until the transaction ends. Every answer
 * write takes this first, and so does final approval: see the module doc.
 */
export async function lockApplication(executor: Executor, userId: string, applicationId: string) {
  const [row] = await executor
    .select()
    .from(application)
    .where(and(eq(application.id, applicationId), eq(application.userId, userId)))
    .for('update');
  if (!row) throw new NotFoundError(`application ${applicationId} not found`);
  return row;
}

/** In the order they were added. The rows themselves, for the gates; the
 *  wire gets `listQuestions`. */
export async function listQuestionRows(
  userId: string,
  applicationId: string,
  executor: Executor = db,
): Promise<QuestionRow[]> {
  const rows = await executor
    .select({ question: applicationQuestion })
    .from(applicationQuestion)
    .innerJoin(application, eq(applicationQuestion.applicationId, application.id))
    .where(
      and(eq(applicationQuestion.applicationId, applicationId), eq(application.userId, userId)),
    )
    // sort_order is dense, but the id breaks a tie all the same (D-030).
    .orderBy(asc(applicationQuestion.sortOrder), asc(applicationQuestion.id));
  return rows.map((row) => row.question);
}

export async function listQuestions(
  userId: string,
  applicationId: string,
): Promise<ApplicationQuestion[]> {
  return (await listQuestionRows(userId, applicationId)).map(toWire);
}

// ---------------------------------------------------------------------------
// Recording questions
// ---------------------------------------------------------------------------

/** One question as the agent reports it. Shape checks are the caller's
 *  (`add_questions` lists every problem before calling); this decides what
 *  is written. */
export interface QuestionInput {
  fieldRef: { page: number; label: string; selector?: string | null };
  prompt: string;
  kind: QuestionKind;
  options: string[] | null;
  required: boolean;
  isEeo: boolean;
  /** Null when nothing is proposed. */
  source: 'profile' | 'agent' | null;
  answerMode: AnswerMode;
  proposedAnswer: AnswerValue | null;
}

export interface RecordedQuestion {
  questionId: string;
  outcome: 'added' | 'unchanged' | 'redrafted';
  /** A proposed answer was dropped because the question is EEO (C10). */
  note?: 'eeo_answer_dropped';
}

/**
 * Appends questions to an application, de-duplicating on `field_ref`
 * (`fieldKey`), and answers one outcome per input, in input order.
 *
 * A question already recorded is left exactly as it is, approved or not:
 * its prompt, kind, options and answer stay what they were first recorded
 * as, so the agent cannot overwrite Chris's edits. The one exception is a
 * question Chris sent back for a redraft, whose new proposal replaces the
 * answer and clears the request.
 *
 * An EEO question, flagged by the caller or matched by `looksLikeEeo`, is
 * recorded with no source and no proposal: it still has to reach Chris.
 *
 * `statuses` are the ones the caller may add to. They are re-checked here
 * under the lock, because the caller's own check ran before it.
 */
export async function addQuestions(
  userId: string,
  applicationId: string,
  inputs: readonly QuestionInput[],
  statuses: readonly ApplicationStatus[],
): Promise<RecordedQuestion[]> {
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, userId, applicationId);
    if (!statuses.includes(app.status)) {
      throw new BadRequestError(
        'This application changed while its questions were being recorded, so nothing was ' +
          'written. Call get_application to see where it stands.',
      );
    }

    const existing = await tx
      .select()
      .from(applicationQuestion)
      .where(eq(applicationQuestion.applicationId, applicationId))
      .for('update');
    const byKey = new Map(existing.map((row) => [fieldKey(row.fieldRef), row]));
    let nextOrder = existing.reduce((last, row) => Math.max(last, row.sortOrder), -1) + 1;

    const outcomes: RecordedQuestion[] = [];
    let wrote = false;
    for (const input of inputs) {
      const fieldRef = normalizeFieldRef(input.fieldRef);
      const found = byKey.get(fieldKey(fieldRef));
      const eeo =
        input.isEeo ||
        looksLikeEeo(input.prompt) ||
        (found !== undefined && (found.isEeo || looksLikeEeo(found.prompt)));
      const sent = encodeAnswer(input.proposedAnswer);
      const proposal = eeo || input.source === null ? null : sent;
      // Said whenever an answer was sent, with a source or without: the tool
      // checks neither on an EEO question, since nothing of it is kept.
      const note = eeo && sent !== null ? { note: 'eeo_answer_dropped' as const } : {};

      if (found) {
        // A redraft is prose for prose: `canRedraft` held when it was asked for.
        const redraft =
          found.redraftNote !== null &&
          canRedraft(found) &&
          proposal !== null &&
          typeof input.proposedAnswer === 'string';
        if (redraft) {
          const [row] = await tx
            .update(applicationQuestion)
            .set({
              source: input.source,
              answerMode: 'value',
              proposedAnswer: proposal,
              answer: proposal,
              redraftNote: null,
              approvedAt: null,
            })
            .where(eq(applicationQuestion.id, found.id))
            .returning();
          if (!row) throw new Error(`question ${found.id} vanished under its lock`);
          byKey.set(fieldKey(fieldRef), row);
          outcomes.push({ questionId: row.id, outcome: 'redrafted' });
          wrote = true;
        } else {
          outcomes.push({ questionId: found.id, outcome: 'unchanged', ...note });
        }
        continue;
      }

      const [row] = await tx
        .insert(applicationQuestion)
        .values({
          applicationId,
          sortOrder: nextOrder++,
          prompt: input.prompt,
          kind: input.kind,
          options: hasOptions(input.kind) ? (input.options ?? []) : null,
          fieldRef,
          required: input.required,
          isEeo: eeo,
          source: proposal === null ? null : input.source,
          answerMode: proposal !== null && hasOptions(input.kind) ? input.answerMode : 'value',
          proposedAnswer: proposal,
          answer: proposal,
        })
        .returning();
      if (!row) throw new Error('failed to record an application question');
      byKey.set(fieldKey(fieldRef), row);
      outcomes.push({ questionId: row.id, outcome: 'added', ...note });
      wrote = true;
    }

    // New questions to approve: a ready application goes back to review (C3).
    if (wrote) await reopenForQuestions(tx, userId, applicationId);
    return outcomes;
  });
}

// ---------------------------------------------------------------------------
// Chris's edits and approvals
// ---------------------------------------------------------------------------

export interface QuestionPatch {
  /** Null clears it. */
  answer?: AnswerValue | null;
  answerMode?: AnswerMode;
  /** A note for the agent asking for a new draft; null cancels the request. */
  redraftNote?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A file answer names one of this application's live attachments. Any
 *  other id, another user's included, reads the same. */
async function assertLiveAttachment(
  executor: Executor,
  applicationId: string,
  fileId: string,
): Promise<void> {
  const [row] = UUID.test(fileId)
    ? await executor
        .select({ id: applicationFile.id })
        .from(applicationFile)
        .where(
          and(
            eq(applicationFile.id, fileId),
            eq(applicationFile.applicationId, applicationId),
            eq(applicationFile.isArchived, false),
          ),
        )
    : [];
  if (!row) throw new BadRequestError(`unknown attachment id: ${fileId}`);
}

/**
 * Chris edits one answer, switches its mode, or asks the agent for a
 * redraft. Allowed until the application is sent.
 *
 * Every accepted write unapproves the question and reopens the application
 * (C3, D-044). There is no diffing: a write that puts back what was there
 * still reopens. Switching mode without an answer clears the answer, since
 * a value read as an instruction, or the reverse, is not what Chris chose.
 */
export async function updateApplicationQuestion(
  userId: string,
  questionId: string,
  patch: QuestionPatch,
): Promise<ApplicationQuestion> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ applicationId: applicationQuestion.applicationId })
      .from(applicationQuestion)
      .innerJoin(application, eq(applicationQuestion.applicationId, application.id))
      .where(and(eq(applicationQuestion.id, questionId), eq(application.userId, userId)));
    if (!owned) throw new NotFoundError(`application question ${questionId} not found`);

    const app = await lockApplication(tx, userId, owned.applicationId);
    const [row] = await tx
      .select()
      .from(applicationQuestion)
      .where(eq(applicationQuestion.id, questionId))
      .for('update');
    if (!row) throw new NotFoundError(`application question ${questionId} not found`);

    if (hasBeenSent(app.status)) {
      throw new BadRequestError(
        `This application is ${statusLabel(app.status)}: it has been sent, so its answers are ` +
          'what went out.',
      );
    }

    const mode = patch.answerMode ?? row.answerMode;
    if (mode === 'instruction' && !hasOptions(row.kind)) {
      throw new BadRequestError('Only a choice question takes an instruction.');
    }
    const answer =
      patch.answer !== undefined ? patch.answer : mode !== row.answerMode ? null : undefined;
    if (answer !== undefined) {
      const problem = answerProblem(row, answer, mode);
      if (problem) throw new BadRequestError(problem);
      if (row.kind === 'file' && typeof answer === 'string' && encodeAnswer(answer) !== null) {
        await assertLiveAttachment(tx, row.applicationId, answer);
      }
    }

    let redraftNote: string | null | undefined;
    if (patch.redraftNote !== undefined) {
      redraftNote = patch.redraftNote?.trim() || null;
      if (redraftNote !== null && !canRedraft(row)) {
        throw new BadRequestError(
          'Only a text or letter question can be sent back for a redraft, and never an EEO one.',
        );
      }
    }

    const [updated] = await tx
      .update(applicationQuestion)
      .set({
        answerMode: mode,
        ...(answer === undefined ? {} : { answer: encodeAnswer(answer) }),
        ...(redraftNote === undefined ? {} : { redraftNote }),
        approvedAt: null,
      })
      .where(eq(applicationQuestion.id, questionId))
      .returning();
    if (!updated) throw new NotFoundError(`application question ${questionId} not found`);

    await reopenForQuestions(tx, userId, row.applicationId);
    return toWire(updated);
  });
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * Chris approves these questions, all of them or none: only in
 * `needs_review`, only questions of this application, and only ones whose
 * answer `approvalProblem` accepts. A refusal lists every problem at once,
 * each prefixed with its prompt. Approving clears a pending redraft request.
 *
 * The ids are the ones Chris saw, never "every profile question": one the
 * agent added after the page loaded is never approved unseen.
 */
export async function approveApplicationQuestions(
  userId: string,
  applicationId: string,
  questionIds: readonly string[],
): Promise<ApplicationQuestion[]> {
  const ids = [...new Set(questionIds)];
  return db.transaction(async (tx) => {
    const app = await lockApplication(tx, userId, applicationId);
    const blocked = sectionApprovalProblem(app, 'questions');
    if (blocked) throw new BadRequestError(blocked);

    const rows =
      ids.length === 0
        ? []
        : await tx
            .select()
            .from(applicationQuestion)
            .where(
              and(
                eq(applicationQuestion.applicationId, applicationId),
                inArray(applicationQuestion.id, ids),
              ),
            )
            .for('update');
    const byId = new Map(rows.map((row) => [row.id, row]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new BadRequestError(`unknown question id: ${unknown.join(', ')}`);

    const files = await tx
      .select({ id: applicationFile.id, isArchived: applicationFile.isArchived })
      .from(applicationFile)
      .where(eq(applicationFile.applicationId, applicationId));
    const problems = ids.flatMap((id) => {
      const row = byId.get(id)!;
      const problem = approvalProblem(approvable(row), files);
      return problem ? [`${row.prompt}: ${lowerFirst(problem)}`] : [];
    });
    if (problems.length > 0) throw new BadRequestError(problems.join(' '));

    if (ids.length === 0) return [];
    const approved = await tx
      .update(applicationQuestion)
      .set({ approvedAt: new Date(), redraftNote: null })
      .where(inArray(applicationQuestion.id, ids))
      .returning();
    const approvedById = new Map(approved.map((row) => [row.id, row]));
    return ids.map((id) => toWire(approvedById.get(id)!));
  });
}

/**
 * Archiving an attachment unapproves the questions it answers, and reopens
 * the application when one was approved: what was approved is no longer
 * something apply can upload. Called by `updateApplicationFile` inside its
 * transaction, after the archive is written.
 */
export async function unapproveFileAnswers(
  executor: Executor,
  userId: string,
  applicationId: string,
  fileId: string,
): Promise<void> {
  const cleared = await executor
    .update(applicationQuestion)
    .set({ approvedAt: null })
    .where(
      and(
        eq(applicationQuestion.applicationId, applicationId),
        eq(applicationQuestion.kind, 'file'),
        eq(applicationQuestion.answer, fileId),
        isNotNull(applicationQuestion.approvedAt),
      ),
    )
    .returning({ id: applicationQuestion.id });
  if (cleared.length > 0) await reopenForQuestions(executor, userId, applicationId);
}
