/**
 * Bullet suggestions' rules (D-045): what one's text may be, when one can be
 * resolved, and how the Approve step sums them up. Pure, like
 * `questions.ts`: the zod schema the tool and the PATCH share
 * (`lib/validation.ts`), the query layer and the review page all ask these,
 * so the page can say what is wrong before the server refuses.
 *
 * A suggestion is one line of plain text, as the bullet should read.
 * Resumix escapes it on its way into LaTeX, so a backslash can only mean
 * the writer reached for LaTeX, which would print as a literal backslash.
 */
import { statusLabel } from './status.ts';
import type { ApplicationStatus, BulletSuggestion } from '../types.ts';

export const SUGGESTION_TEXT_MAX = 500;

/** ASCII whitespace collapsed as `escapeLatex` collapses it, so what is
 *  stored is what prints, and a non-breaking space typed on purpose
 *  survives. */
export function normalizeSuggestionText(text: string): string {
  return text.replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ | $/g, '');
}

type TextProblem = 'empty' | 'long' | 'latex';

function textProblem(text: string): TextProblem | null {
  if (text.length === 0) return 'empty';
  if (text.length > SUGGESTION_TEXT_MAX) return 'long';
  if (text.includes('\\')) return 'latex';
  return null;
}

/** As a request field's error reads after its name (`proposed_text: …`). */
const FIELD_MESSAGES: Record<TextProblem, string> = {
  empty: 'is required',
  long: `must be at most ${SUGGESTION_TEXT_MAX} characters`,
  latex: 'plain text: write it as it should read, without LaTeX',
};

/** As the review page's card says it, on its own. */
const SENTENCES: Record<TextProblem, string> = {
  empty: 'Write the bullet, or reject the suggestion.',
  long: `Shorten it to ${SUGGESTION_TEXT_MAX} characters or fewer.`,
  latex: 'Write it as plain text, as it should read, without LaTeX.',
};

/** Why normalized `text` cannot be a suggestion, worded as a field error,
 *  or null when it can. */
export function suggestionTextProblem(text: string): string | null {
  const problem = textProblem(text);
  return problem && FIELD_MESSAGES[problem];
}

/** The same rule, as a sentence the review page's card can show. */
export function suggestionTextHint(text: string): string | null {
  const problem = textProblem(text);
  return problem && SENTENCES[problem];
}

/** Why no suggestion on an application in `status` can be resolved or
 *  edited, or null: only in Needs review, after the agent has submitted and
 *  before Chris has approved. */
export function suggestionsLocked(status: ApplicationStatus): string | null {
  if (status === 'needs_review') return null;
  return `Suggestions are resolved in Needs review; this application is ${statusLabel(status)}.`;
}

/** The Approve step's line: what is still pending, or what became of them. */
export function suggestionTally(suggestions: readonly Pick<BulletSuggestion, 'status'>[]): {
  pending: number;
  text: string;
} {
  const count = (status: BulletSuggestion['status']) =>
    suggestions.filter((s) => s.status === status).length;
  const pending = count('pending');
  if (pending > 0) {
    return {
      pending,
      text:
        pending === 1
          ? '1 pending — resolve it in step 1'
          : `${pending} pending — resolve them in step 1`,
    };
  }
  const parts = [
    [count('applied'), 'applied'],
    [count('copied'), 'saved as new'],
    [count('rejected'), 'rejected'],
  ] as const;
  return {
    pending,
    text: parts
      .filter(([n]) => n > 0)
      .map(([n, label]) => `${n} ${label}`)
      .join(', '),
  };
}
