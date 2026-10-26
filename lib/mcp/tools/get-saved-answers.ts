/**
 * `get_saved_answers`: the answers Chris ticked "remember" on, for the agent
 * to link to a form's questions with `add_questions` (D-048). Archived ones
 * are absent, so they cannot be linked. Which one fits a question is the
 * agent's call: Resumix does no fuzzy matching (D15).
 */
import { z } from 'zod';
import { listSavedAnswers } from '../../queries/saved-answers.ts';
import { defineTool, toolJson } from '../tool.ts';

export const getSavedAnswers = defineTool({
  name: 'get_saved_answers',
  description:
    "Returns Chris's saved answers as JSON: [{ saved_answer_id, prompt, kind, answer_mode, " +
    'answer }], oldest first, or [] when there are none. prompt is the question he answered; ' +
    'answer is a list of options for a multi answer and a string otherwise, or, with ' +
    'answer_mode instruction, the choice in words. Call it before add_questions. Link a saved ' +
    'answer to a question, by sending its saved_answer_id, only when it plainly answers that ' +
    'question, its kind matches (text and letter count as one), and a value is exactly one of ' +
    "that question's options; an instruction fits any choice. It is the only way an EEO " +
    "question gets an answer before Chris sees it. If you are not sure, don't link it: Chris " +
    'answers in review.',
  input: z.strictObject({}),
  async run(ctx) {
    const saved = await listSavedAnswers(ctx.userId);
    return toolJson(
      saved.map((s) => ({
        saved_answer_id: s.id,
        prompt: s.prompt,
        kind: s.kind,
        answer_mode: s.answerMode,
        answer: s.answer,
      })),
    );
  },
});
