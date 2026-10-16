'use client';

import type { AnswerDraft } from '@/components/applications/QuestionAnswerInput';
import RememberAnswerCheckbox, {
  type RememberState,
} from '@/components/applications/RememberAnswerCheckbox';
import { answerText } from '@/lib/applications/questions';
import type { ApplicationQuestion } from '@/lib/types';

interface SavedAnswerRowProps {
  question: ApplicationQuestion;
  draft: AnswerDraft;
  remember: RememberState;
  onRemember: (remember: boolean) => void;
  /** Swaps the full card in, in place. */
  onEdit: () => void;
}

/**
 * A question the agent answered from one of Chris's saved answers, which
 * arrived approved (D-048): one green line, still on the page so he sees
 * what will be sent. Edit opens the full card, where a change reopens it
 * like any other answer. Unticking retires the saved answer for later
 * forms; this answer stays as it is.
 *
 * Edit follows the text rather than sitting in the bottom-right corner,
 * which the feedback button covers.
 */
export default function SavedAnswerRow({
  question,
  draft,
  remember,
  onRemember,
  onEdit,
}: SavedAnswerRowProps) {
  const answer = answerText({ kind: question.kind, ...draft });
  return (
    <section
      data-testid={`saved-answer-row-${question.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-success-line bg-success-surface/20 px-4 py-2.5"
    >
      <RememberAnswerCheckbox {...remember} onChange={onRemember} compact />
      <p className="min-w-0 truncate text-sm text-success-ink" title={answer}>
        {question.prompt}: {answer}
        <span className="text-success-ink/80"> · saved answer, already approved</span>
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-md px-2 py-0.5 text-sm text-ink-dim underline transition-colors hover:text-accent"
      >
        Edit
      </button>
    </section>
  );
}
