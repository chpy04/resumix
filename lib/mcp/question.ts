/**
 * One question as the agent sends it, and the checks it must pass before
 * anything is written (D-047). Shared, the way `selection.ts` is: discovery
 * records questions with `add_questions`, and the apply pass reports one it
 * never saw with `report_question`, in exactly the same shape, so a field
 * reads the same whichever of them recorded it (D-050).
 *
 * Every problem is found before anything is written, and each names its
 * question. The one exception is EEO (C10): a proposal on an EEO question is
 * dropped, not refused, because the question still has to reach Chris.
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
} from '../applications/questions.ts';
import type { QuestionInput } from '../queries/application-questions.ts';

const text = z.string().trim().min(1, 'is required');

const fieldRef = z.strictObject({
  page: z.number().int().min(0).describe('The form page the field is on, counting from 0.'),
  label: text.describe("The field's visible label, as the form shows it."),
  selector: z
    .string()
    .nullable()
    .optional()
    .describe(
      'A Playwright role selector for the field (e.g. role=textbox[name="…"]), when you have one.',
    ),
});

export const questionInput = z.strictObject({
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
  saved_answer_id: z
    .uuid()
    .optional()
    .describe(
      'A saved answer from get_saved_answers that plainly answers this question. Send it ' +
        'instead of source, answer_mode and proposed_answer.',
    ),
});

export type QuestionArgs = z.output<typeof questionInput>;

/** Everything wrong with these inputs, each named by its path in the
 *  arguments (`at`) and its label. */
export function findQuestionProblems(
  questions: readonly QuestionArgs[],
  at: (index: number) => string = (index) => `questions.${index}`,
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, number>();

  questions.forEach((q, index) => {
    const name = `${at(index)} ("${q.field_ref.label.trim()}")`;
    const say = (problem: string) => problems.push(`${name}: ${problem}`);

    const key = fieldKey(q.field_ref);
    const first = seen.get(key);
    if (first !== undefined) say(`has the same field_ref as ${at(first)}`);
    else seen.set(key, index);

    if (hasOptions(q.kind) && q.options === undefined) say(`a ${q.kind} question needs options`);
    if (!hasOptions(q.kind) && q.options !== undefined) {
      say('only a choice or multi question takes options');
    }
    if (q.options && new Set(q.options).size !== q.options.length) say('lists an option twice');

    if (q.saved_answer_id !== undefined) {
      if (
        q.source !== undefined ||
        q.answer_mode !== undefined ||
        q.proposed_answer !== undefined
      ) {
        say('send saved_answer_id alone; its answer, mode and source come from the saved answer');
      }
      // Whether it fits is the query's check, against the saved answer.
      return;
    }

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

/** The query's input, field by field. */
export function toQuestionInput(q: QuestionArgs): QuestionInput {
  return {
    fieldRef: q.field_ref,
    prompt: q.prompt,
    kind: q.kind,
    options: q.options ?? null,
    required: q.required,
    isEeo: q.is_eeo ?? false,
    source: q.source ?? null,
    answerMode: q.answer_mode ?? 'value',
    proposedAnswer: q.proposed_answer ?? null,
    savedAnswerId: q.saved_answer_id,
  };
}
