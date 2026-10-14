/**
 * `report_question`: the apply pass met a field nobody has seen, so it is
 * recorded for Chris to answer, and the application goes back to Needs
 * review (C3, R12, D-050).
 *
 * The question has exactly `add_questions`' shape and checks
 * (`question.ts`), and goes through the same query, so a field reads the
 * same whichever of them recorded it. Allowed while the application is
 * Ready, and while it is in Needs review, so every new field on one page is
 * reported before the agent stops and Chris reviews them in one round. A
 * field already recorded is refused rather than reopening anything: it is
 * in the packet, and the agent fills it from there.
 */
import { z } from 'zod';
import { hasBeenSent } from '../../applications/status.ts';
import { addQuestions, listQuestions } from '../../queries/application-questions.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { findQuestionProblems, questionInput, toQuestionInput } from '../question.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

export const reportQuestion = defineTool({
  name: 'report_question',
  description:
    'Reports a field on the real form that the apply packet does not have, so Chris can ' +
    'answer it. Call it while applying, once for each such field on the page, required or ' +
    'not, then stop filling and tell Chris. question has the shape add_questions takes: ' +
    'field_ref (page counting from 0, the visible label, a selector hint), prompt, kind, ' +
    'options, required, is_eeo, and a proposal or saved_answer_id as add_questions allows; ' +
    'never propose an EEO answer. Allowed while the application is ready or needs_review: a ' +
    'ready application goes back to needs_review, and get_apply_packet is refused until Chris ' +
    'approves it again. A field_ref already recorded is refused, since the packet has it. ' +
    'Returns JSON { question_id, outcome, note?, status: "needs_review" }; note ' +
    'eeo_answer_dropped means an answer you proposed was dropped.',
  input: z.strictObject({ application_id: z.uuid(), question: questionInput }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    if (app.status === 'proposing') {
      return toolError(
        'This application is still proposing; record questions with add_questions. Nothing ' +
          'was recorded.',
      );
    }
    if (app.status !== 'ready' && app.status !== 'needs_review') {
      const what = hasBeenSent(app.status)
        ? `${app.status}: it has been sent`
        : 'a draft Chris logged by hand';
      return toolError(
        `This application is ${what}, so it is not being applied to. Nothing was recorded. ` +
          'Stop and tell Chris.',
      );
    }

    const problems = findQuestionProblems([args.question], () => 'question');
    if (problems.length > 0) {
      return toolError(`Nothing was written: ${problems.join('; ')}. Fix these and call again.`);
    }

    // The statuses are re-checked under the application's lock, and a write
    // reopens a Ready application in the same transaction.
    const [recorded] = await addQuestions(
      ctx.userId,
      app.id,
      [toQuestionInput(args.question)],
      ['ready', 'needs_review'],
    );
    if (!recorded) throw new Error('add_questions answered no outcome for one question');

    if (recorded.outcome === 'unchanged') {
      const known = (await listQuestions(ctx.userId, app.id)).find(
        (q) => q.id === recorded.questionId,
      );
      return toolError(
        `That field is already question ${recorded.questionId} ("${known?.prompt ?? ''}") in ` +
          'the apply packet. Nothing was changed. Fill it from the packet entry with that ' +
          'field_ref.',
      );
    }

    return toolJson({
      question_id: recorded.questionId,
      outcome: recorded.outcome,
      ...(recorded.note ? { note: recorded.note } : {}),
      status: 'needs_review',
    });
  },
});
