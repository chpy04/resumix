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
 * is dropped before it is written, whoever flagged it. A saved answer is not
 * a proposal: Chris made it, so it is kept on an EEO question too (D-048).
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
  rememberProblem,
  savedAnswerProblem,
} from '../applications/questions.ts';
import { sectionApprovalProblem } from '../applications/review.ts';
import { hasBeenSent, statusLabel } from '../applications/status.ts';
import { db, type Executor } from '../db/index.ts';
import { application, applicationFile, applicationQuestion, savedAnswer } from '../db/schema.ts';
import type {
  AnswerMode,
  AnswerValue,
  ApplicationQuestion,
  ApplicationStatus,
  QuestionKind,
} from '../types.ts';
import { reopenForQuestions } from './approvals.ts';
import { BadRequestError, NotFoundError } from './errors.ts';
import {
  archiveSavedAnswer,
  insertSavedAnswer,
  liveSavedAnswers,
  updateSavedAnswer,
} from './saved-answers.ts';

type QuestionRow = typeof applicationQuestion.$inferSelect;

/** `liveSavedAnswerId` is the row's link when it names one of the owner's
 *  saved answers that is not archived, and null otherwise (D-048). */
function toWire(row: QuestionRow, liveSavedAnswerId: string | null): ApplicationQuestion {
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
    savedAnswerId: liveSavedAnswerId,
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
 *  wire gets `listQuestions`. Each carries its live saved-answer link
 *  (`toWire`). */
export async function listQuestionRows(
  userId: string,
  applicationId: string,
  executor: Executor = db,
): Promise<(QuestionRow & { liveSavedAnswerId: string | null })[]> {
  const rows = await executor
    .select({ question: applicationQuestion, liveSavedAnswerId: savedAnswer.id })
    .from(applicationQuestion)
    .innerJoin(application, eq(applicationQuestion.applicationId, application.id))
    // On the caller as well: a link to anyone else's reads as no link.
    .leftJoin(
      savedAnswer,
      and(
        eq(savedAnswer.id, applicationQuestion.savedAnswerId),
        eq(savedAnswer.userId, userId),
        eq(savedAnswer.isArchived, false),
      ),
    )
    .where(
      and(eq(applicationQuestion.applicationId, applicationId), eq(application.userId, userId)),
    )
    // sort_order is dense, but the id breaks a tie all the same (D-030).
    .orderBy(asc(applicationQuestion.sortOrder), asc(applicationQuestion.id));
  return rows.map((row) => ({ ...row.question, liveSavedAnswerId: row.liveSavedAnswerId }));
}

export async function listQuestions(
  userId: string,
  applicationId: string,
): Promise<ApplicationQuestion[]> {
  return (await listQuestionRows(userId, applicationId)).map((row) =>
    toWire(row, row.liveSavedAnswerId),
  );
}

/** Which of these rows' links are live, for `toWire`. */
async function liveLinks(
  executor: Executor,
  userId: string,
  rows: readonly QuestionRow[],
): Promise<Set<string>> {
  const ids = rows.flatMap((row) => (row.savedAnswerId ? [row.savedAnswerId] : []));
  return new Set((await liveSavedAnswers(executor, userId, ids)).map((saved) => saved.id));
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
  /** One of Chris's saved answers that answers this question (D-048). When
   *  set, it supplies the source, mode and answer, and the three above are
   *  ignored; the caller refuses a request that sends both. */
  savedAnswerId?: string;
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
 * A new question linked to a saved answer (`savedAnswerId`) arrives with
 * that answer, `source: 'saved'`, already approved, EEO or not: Chris made
 * the answer, and he still sees the question (D-048). A redraft linked to
 * one takes it, but stays unapproved, since Chris asked to see it again. A
 * question already recorded ignores the link. Every link must be one of
 * the caller's live saved answers that fits the question exactly
 * (`savedAnswerProblem`), or nothing is written and every problem is named.
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

    const linked = await liveSavedAnswers(
      tx,
      userId,
      inputs.flatMap((input) => (input.savedAnswerId ? [input.savedAnswerId] : [])),
    );
    const savedById = new Map(linked.map((saved) => [saved.id, saved]));
    const problems = inputs.flatMap((input, index) => {
      if (input.savedAnswerId === undefined) return [];
      const name = `questions.${index} ("${normalizeFieldRef(input.fieldRef).label}")`;
      const saved = savedById.get(input.savedAnswerId);
      // Unknown, archived and another user's all read the same.
      if (!saved) {
        return [`${name}: no saved answer ${input.savedAnswerId} (get_saved_answers lists yours)`];
      }
      // Checked against the question as it would be stored: as first
      // recorded, when it already is.
      const problem = savedAnswerProblem(byKey.get(fieldKey(input.fieldRef)) ?? input, saved);
      // Its own full stop would sit before the next problem's semicolon.
      const reason = problem && lowerFirst(problem).replace(/\.$/, '');
      return reason ? [`${name}: saved answer ${saved.id} does not fit: ${reason}`] : [];
    });
    if (problems.length > 0) {
      throw new BadRequestError(
        `Nothing was written: ${problems.join('; ')}. Call again with those questions sent ` +
          'without saved_answer_id; Chris answers them in review.',
      );
    }

    const outcomes: RecordedQuestion[] = [];
    let wrote = false;
    for (const input of inputs) {
      const fieldRef = normalizeFieldRef(input.fieldRef);
      const found = byKey.get(fieldKey(fieldRef));
      const eeo =
        input.isEeo ||
        looksLikeEeo(input.prompt) ||
        (found !== undefined && (found.isEeo || looksLikeEeo(found.prompt)));
      const saved = input.savedAnswerId ? savedById.get(input.savedAnswerId) : undefined;
      // A link stands in for a proposal: the saved answer supplies it.
      const sent = saved ? null : encodeAnswer(input.proposedAnswer);
      const proposal = eeo || input.source === null ? null : sent;
      // Said whenever an answer was sent, with a source or without: the tool
      // checks neither on an EEO question, since nothing of it is kept.
      const note = eeo && sent !== null ? { note: 'eeo_answer_dropped' as const } : {};
      // A saved answer is Chris's own, so EEO does not drop it (C10).
      const fromSaved = saved
        ? {
            source: 'saved' as const,
            savedAnswerId: saved.id,
            answerMode: saved.answerMode,
            proposedAnswer: encodeAnswer(saved.answer),
            answer: encodeAnswer(saved.answer),
          }
        : null;

      if (found) {
        // A redraft is prose for prose: `canRedraft` held when it was asked
        // for, and `savedAnswerProblem` holds for a saved one.
        const redraft =
          found.redraftNote !== null &&
          canRedraft(found) &&
          (fromSaved !== null || (proposal !== null && typeof input.proposedAnswer === 'string'));
        if (redraft) {
          const [row] = await tx
            .update(applicationQuestion)
            .set({
              ...(fromSaved ?? {
                source: input.source,
                answerMode: 'value' as const,
                proposedAnswer: proposal,
                answer: proposal,
              }),
              redraftNote: null,
              // Even from a saved answer: Chris asked to see this one again.
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
          ...(fromSaved
            ? { ...fromSaved, approvedAt: new Date() }
            : {
                source: proposal === null ? null : input.source,
                answerMode:
                  proposal !== null && hasOptions(input.kind) ? input.answerMode : 'value',
                proposedAnswer: proposal,
                answer: proposal,
              }),
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
 *
 * While the question is remembered, a new answer is written through to its
 * saved answer as well: a global edit, like a bullet's, and the checkbox's
 * hint says so (D-048). Clearing the answer writes nothing through, and the
 * prompt stays as it was first saved.
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

    const [remembered] = row.savedAnswerId
      ? await liveSavedAnswers(tx, userId, [row.savedAnswerId])
      : [];
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

    const stored = answer === undefined ? null : encodeAnswer(answer);
    if (remembered && stored !== null) {
      await updateSavedAnswer(tx, userId, remembered.id, { answer: stored, answerMode: mode });
    }

    await reopenForQuestions(tx, userId, row.applicationId);
    return toWire(updated, remembered?.id ?? null);
  });
}

/**
 * Chris ticks or unticks "remember this answer" (D-048). Ticking needs an
 * answer `rememberProblem` accepts: it updates the saved answer the question
 * is linked to, or saves a new one from the question's prompt, kind, mode
 * and answer and links it. Unticking archives the linked one and unlinks
 * it, which is the only way to retire a saved answer, since there is no
 * page for them. Refused once the application has been sent.
 *
 * Neither touches the answer, its source or its approval, and neither
 * reopens anything: remembering an answer is not an edit to it (C3). So it
 * is its own endpoint, apart from the PATCH, which unapproves on every
 * write.
 */
export async function setQuestionRemembered(
  userId: string,
  questionId: string,
  remember: boolean,
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

    // A dead link, or one to another user's, is no link: ticking saves anew,
    // and unticking archives nothing.
    const [linked] = row.savedAnswerId
      ? await liveSavedAnswers(tx, userId, [row.savedAnswerId])
      : [];
    let link: string | null = null;
    if (remember) {
      const problem = rememberProblem(approvable(row));
      // `rememberProblem` refuses no answer, so `row.answer` is set past it.
      if (problem || row.answer === null) throw new BadRequestError(problem ?? 'Answer it first.');
      const values = { answer: row.answer, answerMode: row.answerMode };
      if (linked) {
        await updateSavedAnswer(tx, userId, linked.id, values);
        link = linked.id;
      } else {
        const saved = await insertSavedAnswer(tx, userId, {
          ...values,
          prompt: row.prompt,
          kind: row.kind,
        });
        link = saved.id;
      }
    } else if (linked) {
      await archiveSavedAnswer(tx, userId, linked.id);
    }

    const [updated] = await tx
      .update(applicationQuestion)
      .set({ savedAnswerId: link })
      .where(eq(applicationQuestion.id, questionId))
      .returning();
    if (!updated) throw new NotFoundError(`application question ${questionId} not found`);
    return toWire(updated, link);
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
    const live = await liveLinks(tx, userId, approved);
    return ids.map((id) => {
      const row = approvedById.get(id)!;
      return toWire(
        row,
        row.savedAnswerId && live.has(row.savedAnswerId) ? row.savedAnswerId : null,
      );
    });
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
