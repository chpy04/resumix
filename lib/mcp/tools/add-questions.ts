/**
 * `add_questions`: records the questions an application's form asks, with
 * the answer the agent proposes for each, for Chris to review (D-047).
 *
 * Appends, de-duplicating on `field_ref`: a question already recorded is
 * left as it is, except one Chris sent back for a redraft, whose new
 * proposal replaces the answer. Every refusal happens before anything is
 * written and lists every problem, as `set_resume_selection` does. The one
 * exception is EEO (C10): a proposal on an EEO question is dropped, not
 * refused, because the question still has to reach Chris.
 *
 * A question can instead name one of Chris's saved answers (D-048), which
 * the agent picked from `get_saved_answers`; Resumix matches nothing itself
 * (D15). The query checks the link fits, under the lock; this checks only
 * that it comes alone.
 *
 * The status rule is here rather than in `addQuestions`, so
 * `report_question`, which adds to a Ready application, reuses the query;
 * the question's shape and checks are shared with it too (`question.ts`).
 */
import { z } from 'zod';
import { hasBeenSent } from '../../applications/status.ts';
import { addQuestions as recordQuestions } from '../../queries/application-questions.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { findQuestionProblems, questionInput, toQuestionInput } from '../question.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

export const addQuestions = defineTool({
  name: 'add_questions',
  description:
    "Records the questions an application's form asks, with the answer you propose for each, " +
    'for Chris to review. Call it while the application is proposing or needs_review. ' +
    'field_ref says where the field is: page (counting from 0), its visible label, and an ' +
    'optional selector hint; page and label identify the question, so a field_ref already ' +
    'recorded is left as it is. The resume and cover letter upload fields are not questions: ' +
    'leave them out. Never propose an answer to an EEO or demographic question (gender, race, ' +
    'ethnicity, veteran status, disability, sexual orientation): set is_eeo, leave ' +
    'proposed_answer out, and Chris answers it. A file question takes no proposed_answer. ' +
    'proposed_answer comes with a source: profile when it is from his profile, agent when you ' +
    'wrote it. It is one of options exactly for choice, a list of options for multi, yes or no ' +
    'for bool, or, for choice and multi only, answer_mode instruction with the choice in words. ' +
    'When get_application shows a question with a redraft_note, Chris wants a new draft: call ' +
    'this again with its field_ref and the new proposed_answer. Call get_saved_answers first: ' +
    "when one of Chris's saved answers plainly answers a question, send its saved_answer_id " +
    'instead of a proposal, and the question arrives with that answer, already approved. It ' +
    'must be the same kind (text and letter count as one; never file) and, for a value, use ' +
    "this question's options exactly. It is the only way to answer an EEO question. If you " +
    'are not sure it fits, leave it out: Chris answers in review. Returns JSON { questions: ' +
    '[{ question_id, outcome, note? }] } in input order: outcome is added, unchanged or ' +
    'redrafted, and note eeo_answer_dropped means an answer you proposed was dropped.',
  input: z.strictObject({
    application_id: z.uuid(),
    questions: z.array(questionInput).min(1, 'is empty'),
  }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);

    if (app.status === 'ready') {
      return toolError(
        "This application is ready: Chris has approved it, so its questions can't change " +
          'here. Nothing was written; stop and tell Chris.',
      );
    }
    if (app.status !== 'proposing' && app.status !== 'needs_review') {
      const what = hasBeenSent(app.status)
        ? `${app.status}: it has been sent`
        : 'a draft Chris logged by hand';
      return toolError(
        `This application is ${what}, not one you are proposing, so it takes no questions. ` +
          'Nothing was written. Call list_applications to find the one you are working on.',
      );
    }

    const problems = findQuestionProblems(args.questions);
    if (problems.length > 0) {
      return toolError(
        `Nothing was written: ${problems.join('; ')}. Fix these and call again with every ` +
          'question.',
      );
    }

    const recorded = await recordQuestions(
      ctx.userId,
      app.id,
      args.questions.map(toQuestionInput),
      ['proposing', 'needs_review'],
    );

    return toolJson({
      questions: recorded.map((q) => ({
        question_id: q.questionId,
        outcome: q.outcome,
        ...(q.note ? { note: q.note } : {}),
      })),
    });
  },
});
