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
import type { ApplicationFile, ApplicationQuestion } from '@/lib/types';

/** What the group needs to know about each of its rows. */
export interface ProfileRow {
  question: ApplicationQuestion;
  draft: AnswerDraft;
  approved: boolean;
  reopened: boolean;
  problem: string | null;
  /** Saving, or changed on screen and not saved yet. */
  unsaved: boolean;
  remember: RememberState;
}

interface ProfileAnswersGroupProps {
  rows: ProfileRow[];
  files: ApplicationFile[];
  applicationId: string;
  /** Why nothing can be approved in this status, or null in Needs review. */
  blockedBy: string | null;
  onChange: (question: ApplicationQuestion, next: AnswerDraft, immediate: boolean) => void;
  onRemember: (question: ApplicationQuestion, remember: boolean) => void;
  /** Approves exactly these ids. Throws `ApiError` listing every problem. */
  onApprove: (ids: string[]) => Promise<void>;
  onFileUploaded: (file: ApplicationFile) => void;
}

/** "Name, Email, School, Work authorization, …" */
function preview(rows: readonly ProfileRow[]): string {
  const names = rows.slice(0, 4).map((row) => row.question.prompt);
  return rows.length > 4 ? `${names.join(', ')}, …` : names.join(', ');
}

/**
 * The answers taken from Chris's profile, collapsed into one bar, because
 * they are the ones he approves in bulk: name, email, school and the like.
 * "Approve all" sends the ids of the rows on screen, never "every profile
 * question", so one the agent adds after the page loaded is not approved
 * unseen (D-047). An EEO question is never in this group (C10).
 */
export default function ProfileAnswersGroup({
  rows,
  files,
  applicationId,
  blockedBy,
  onChange,
  onRemember,
  onApprove,
  onFileUploaded,
}: ProfileAnswersGroupProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = rows.filter((row) => !row.approved);
  const allApproved = pending.length === 0;
  const unsaved = rows.some((row) => row.unsaved);

  async function approveAll(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onApprove(pending.map((row) => row.question.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve these answers.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="profile-answers"
      className={`flex flex-col rounded-lg border ${
        allApproved ? 'border-success-line bg-success-surface/20' : 'border-line bg-surface-2'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={`min-w-0 truncate text-left text-sm ${
            allApproved ? 'text-success-ink' : 'text-ink-dim'
          } transition-colors hover:text-ink`}
        >
          {open ? '▾' : '▸'}{' '}
          {allApproved
            ? `✓ ${rows.length} from profile, approved`
            : `${rows.length} from profile (${preview(rows)})`}
        </button>
        {allApproved ? null : (
          <button
            type="button"
            onClick={() => void approveAll()}
            disabled={busy || unsaved || blockedBy !== null}
            title={blockedBy ?? (unsaved ? 'Waiting for your changes to save' : undefined)}
            className="shrink-0 rounded-md border border-success-line bg-success-surface/30 px-3 py-1 text-sm font-medium text-success-ink transition-colors hover:bg-success-surface/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Approving…' : `Approve all ${pending.length}`}
          </button>
        )}
      </div>
      {error ? <p className="px-4 pb-2.5 text-xs text-danger">{error}</p> : null}

      {open ? (
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {rows.map((row) => (
            <li
              key={row.question.id}
              data-testid={`question-card-${row.question.id}`}
              className="flex flex-wrap items-center gap-3 px-4 py-2"
            >
              <span className="w-40 shrink-0 truncate text-sm text-ink" title={row.question.prompt}>
                {row.question.prompt}
              </span>
              <div className="min-w-48 flex-1">
                <QuestionAnswerInput
                  question={row.question}
                  draft={row.draft}
                  files={files}
                  applicationId={applicationId}
                  onChange={(next, immediate) => onChange(row.question, next, immediate)}
                  onFileUploaded={onFileUploaded}
                  compact
                />
              </div>
              {row.question.required ? (
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-dim">
                  Required
                </span>
              ) : null}
              {row.question.kind === 'file' ? null : (
                <RememberAnswerCheckbox
                  {...row.remember}
                  onChange={(remember) => onRemember(row.question, remember)}
                  compact
                />
              )}
              <QuestionApproveButton
                approved={row.approved}
                reopened={row.reopened}
                problem={row.problem}
                disabledReason={
                  blockedBy ?? (row.unsaved ? 'Waiting for your changes to save' : null)
                }
                onApprove={() => onApprove([row.question.id])}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
