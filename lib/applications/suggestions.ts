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

/** Why normalized `text` cannot be a suggestion, or null when it can. */
export function suggestionTextProblem(text: string): string | null {
  if (text.length === 0) return 'is required';
  if (text.length > SUGGESTION_TEXT_MAX) {
    return `must be at most ${SUGGESTION_TEXT_MAX} characters`;
  }
  if (text.includes('\\')) return 'plain text: write it as it should read, without LaTeX';
  return null;
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
