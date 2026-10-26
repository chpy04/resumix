'use client';

import { useState } from 'react';
import QuestionAnswerInput, {
  type AnswerDraft,
} from '@/components/applications/QuestionAnswerInput';
import QuestionApproveButton from '@/components/applications/QuestionApproveButton';
import RememberAnswerCheckbox, {
  type RememberState,
} from '@/components/applications/RememberAnswerCheckbox';
import { ApiError } from '@/lib/api-client';
import { canRedraft, hasOptions } from '@/lib/applications/questions';
import type { ApplicationFile, ApplicationQuestion } from '@/lib/types';

interface QuestionCardProps {
  question: ApplicationQuestion;
  draft: AnswerDraft;
  files: ApplicationFile[];
  applicationId: string;
  /** Approved on the server, and nothing on screen has changed since. */
  approved: boolean;
  reopened: boolean;
  /** `approvalProblem` for what is on screen. */
  problem: string | null;
  disabledReason: string | null;
  /** "Remember this answer", offered on every kind but a file (D-048). */
  remember: RememberState;
  onChange: (next: AnswerDraft, immediate: boolean) => void;
  onRemember: (remember: boolean) => void;
  onApprove: () => Promise<void>;
  /** Sends a redraft request, or cancels one with null. Throws to show. */
  onRedraft: (note: string | null) => Promise<void>;
  onFileUploaded: (file: ApplicationFile) => void;
}

/** The card's colour says what kind of answer it wants, until it is done. */
function tone(question: ApplicationQuestion, approved: boolean, waiting: boolean): string {
  if (approved) return 'border-success-line bg-success-surface/20';
  if (waiting) return 'border-line bg-surface-2';
  if (question.isEeo) return 'border-danger-line bg-danger-surface/20';
  if (question.kind === 'text' || question.kind === 'letter') {
    return 'border-warning-line bg-warning-surface/20';
  }
  if (hasOptions(question.kind) || question.kind === 'bool') return 'border-accent/50 bg-accent/5';
  return 'border-line bg-surface';
}

function sourceLabel(question: ApplicationQuestion): string | null {
  if (question.source === 'agent') return 'agent draft';
  if (question.source === 'profile') return 'from profile';
  return null;
}

/**
 * One question that is not a profile answer: open-ended prose, which can be
 * sent back for a redraft; a choice, which takes a value or an instruction;
 * a file, answered with an attachment; or an EEO question, which only Chris
 * answers and which starts with nothing picked (C10, D-047). Every kind but
 * a file can be remembered for later forms (D-048).
 */
export default function QuestionCard({
  question,
  draft,
  files,
  applicationId,
  approved,
  reopened,
  problem,
  disabledReason,
  remember,
  onChange,
  onRemember,
  onApprove,
  onRedraft,
  onFileUploaded,
}: QuestionCardProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [redraftError, setRedraftError] = useState<string | null>(null);

  const waiting = question.redraftNote !== null;
  const source = sourceLabel(question);

  async function sendRedraft(next: string | null): Promise<void> {
    setSending(true);
    setRedraftError(null);
    try {
      await onRedraft(next);
      setNoteOpen(false);
      setNote('');
    } catch (err) {
      setRedraftError(err instanceof ApiError ? err.message : 'Could not send that to the agent.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      data-testid={`question-card-${question.id}`}
      className={`flex flex-col gap-3 rounded-lg border p-4 ${tone(question, approved, waiting)}`}
    >
      <h3 className="text-sm font-semibold text-ink">
        {question.prompt}
        {question.isEeo ? (
          <span className="font-normal text-danger-ink">
            {' '}
            (EEO) — the agent never answers these. You choose:
          </span>
        ) : null}
        {question.required ? (
          <span className="ml-2 text-xs font-normal text-warning-ink">* Required</span>
        ) : null}
        {source ? <span className="text-xs font-normal text-ink-dim"> · {source}</span> : null}
        {question.source === 'saved' ? (
          <span className="ml-2 rounded-full border border-success-line px-2 py-0.5 text-[10px] font-normal text-success-ink">
            saved answer
          </span>
        ) : null}
      </h3>

      <QuestionAnswerInput
        question={question}
        draft={draft}
        files={files}
        applicationId={applicationId}
        onChange={onChange}
        onFileUploaded={onFileUploaded}
      />

      {waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-dim">
          <span>
            Redraft requested: &ldquo;{question.redraftNote}&rdquo; — waiting for the agent
          </span>
          <button
            type="button"
            disabled={sending}
            onClick={() => void sendRedraft(null)}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Cancel request
          </button>
        </div>
      ) : null}

      {!waiting && noteOpen ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) void sendRedraft(note);
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-ink-dim">
            What should change?
            <input
              type="text"
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={sending || !note.trim()}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send to agent'}
          </button>
          <button
            type="button"
            onClick={() => setNoteOpen(false)}
            className="rounded-md px-2 py-1 text-xs text-ink-dim transition-colors hover:text-ink"
          >
            Cancel
          </button>
        </form>
      ) : null}

      {redraftError ? <p className="text-xs text-danger">{redraftError}</p> : null}

      {waiting ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {question.kind === 'file' ? null : (
            <div className="mr-auto">
              <RememberAnswerCheckbox {...remember} onChange={onRemember} />
            </div>
          )}
          {canRedraft(question) && !noteOpen && !approved ? (
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-dim transition-colors hover:border-accent hover:text-accent"
            >
              Redraft
            </button>
          ) : null}
          <QuestionApproveButton
            approved={approved}
            reopened={reopened}
            problem={problem}
            disabledReason={disabledReason}
            onApprove={onApprove}
          />
        </div>
      )}
    </section>
  );
}
