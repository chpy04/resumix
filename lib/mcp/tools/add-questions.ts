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
 * The status rule is here rather than in `addQuestions`, so a later tool
 * that may add to a Ready application can reuse the query.
 */
import { z } from 'zod';
import {
  ANSWER_MODES,
  answerProblem,
  encodeAnswer,
  fieldKey,
  hasOptions,
  looksLikeEeo,
  QUESTION_KINDS,
} from '../../applications/questions.ts';
import { hasBeenSent } from '../../applications/status.ts';
import { addQuestions as recordQuestions } from '../../queries/application-questions.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson } from '../tool.ts';

const text = z.string().trim().min(1, 'is required');

const fieldRef = z.strictObject({
  page: z.number().int().min(0).describe('The form page the field is on, counting from 0.'),
  label: text.describe("The field's visible label, as the form shows it."),
  selector: z
    .string()
    .nullable()
    .optional()
    .describe('A CSS selector hint for the field, when you have one.'),
});

const questionInput = z.strictObject({
  field_ref: fieldRef,
  prompt: text.describe('The question as the form words it.'),
  kind: z.enum(QUESTION_KINDS),
  options: z
    .array(z.string().min(1, 'is empty'))
    .min(1, 'is empty')
    .optional()
    .describe('The choices a choice or multi question offers, exactly as the form lists them.'),
  required: z.boolean(),
  is_eeo: z
    .boolean()
    .optional()
    .describe('True for an EEO or demographic question. Propose no answer to one.'),
  source: z
    .enum(['profile', 'agent'])
    .optional()
    .describe("Where proposed_answer came from: Chris's profile, or written by you."),
  answer_mode: z.enum(ANSWER_MODES).optional(),
  proposed_answer: z.union([z.string(), z.array(z.string())]).optional(),
});

type QuestionArgs = z.output<typeof questionInput>;

/** Everything wrong with these inputs, each naming the question. */
function findQuestionProblems(questions: readonly QuestionArgs[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();

  questions.forEach((q, index) => {
    const name = `questions.${index} ("${q.field_ref.label.trim()}")`;
    const say = (problem: string) => problems.push(`${name}: ${problem}`);

    const key = fieldKey(q.field_ref);
    const first = seen.get(key);
    if (first !== undefined) say(`has the same field_ref as questions.${first}`);
    else seen.set(key, index);

    if (hasOptions(q.kind) && q.options === undefined) say(`a ${q.kind} question needs options`);
    if (!hasOptions(q.kind) && q.options !== undefined) {
      say('only a choice or multi question takes options');
    }
    if (q.options && new Set(q.options).size !== q.options.length) say('lists an option twice');

    // Dropped, not checked: an EEO question keeps no proposal whatever it is,
    // source or none, and the outcome's note says one was dropped.
    if (q.is_eeo || looksLikeEeo(q.prompt)) return;

    const mode = q.answer_mode ?? 'value';
    if (mode === 'instruction' && !hasOptions(q.kind)) {
      say('answer_mode instruction is only for a choice or multi question');
    }
    const proposed = q.proposed_answer ?? null;
    if (q.kind === 'file' && proposed !== null) {
      say('a file question takes no proposed_answer; Chris picks the attachment');
      return;
    }
    if (proposed !== null && q.source === undefined) say('proposed_answer needs a source');
    if (proposed === null && q.source !== undefined) say('source needs a proposed_answer');
    if (proposed === null) return;
    if (encodeAnswer(proposed) === null) {
      say('proposed_answer is empty; leave it out to propose nothing');
      return;
    }
    const problem = answerProblem({ kind: q.kind, options: q.options ?? null }, proposed, mode);
    if (problem) say(`proposed_answer: ${problem}`);
  });

  return problems;
}

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
    'this again with its field_ref and the new proposed_answer. Returns JSON { questions: ' +
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
      args.questions.map((q) => ({
        fieldRef: q.field_ref,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options ?? null,
        required: q.required,
        isEeo: q.is_eeo ?? false,
        source: q.source ?? null,
        answerMode: q.answer_mode ?? 'value',
        proposedAnswer: q.proposed_answer ?? null,
      })),
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
