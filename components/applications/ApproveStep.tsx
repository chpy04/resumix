'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, approveApplication, renderCoverLetter, renderResume } from '@/lib/api-client';
import {
  applyCommand,
  finalApprovalProblems,
  reviewStateOf,
  type ReviewStep,
  type ReviewStepKey,
} from '@/lib/applications/review';
import { questionProgress } from '@/lib/applications/questions';
import { canCopy, copyText, type CopyResult } from '@/lib/clipboard';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { ApplicationDetail } from '@/lib/types';

interface ApproveStepProps {
  application: ApplicationDetail;
  steps: ReviewStep[];
  onGoTo: (key: ReviewStepKey) => void;
  onApproved: (application: ApplicationDetail) => void;
  /** The resume editor's autosave. Approving while an edit is unsaved would
   *  snapshot the resume without it. */
  resumeSaveStatus: SaveStatus;
  /** The questions step's autosave, for the same reason. */
  questionsSaveStatus: SaveStatus;
}

/** Why unsaved edits stop final approval for now, or null. */
function unsavedReason(resume: SaveStatus, questions: SaveStatus): string | null {
  if (resume === 'saving') return 'Waiting for your resume changes to save.';
  if (resume === 'error') return "A resume change didn't save. Go to step 1 and retry it.";
  if (questions === 'saving') return 'Waiting for your answers to save.';
  if (questions === 'error') return "An answer didn't save. Go to the questions and retry it.";
  return null;
}

/** `undefined` while the count is being compiled; `null` when it could not be. */
type Pages = number | null | undefined;

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
}

/**
 * The last step: what is about to be sent, and the one button that makes it
 * `ready` (C3, C4, D-044).
 *
 * Final approval compiles both documents and pins them, then copies the
 * command that hands the application to the applying agent. The copy is
 * the part most likely to fail: the Clipboard API needs a secure context,
 * and a browser may refuse a write that arrives seconds after the click. So
 * a failed copy shows the command, selected, to copy by hand.
 *
 * One page is not enforced here; `submit_for_review` enforces it. A longer
 * document is a warning on its row.
 */
export default function ApproveStep({
  application,
  steps,
  onGoTo,
  onApproved,
  resumeSaveStatus,
  questionsSaveStatus,
}: ApproveStepProps) {
  const [resumePages, setResumePages] = useState<Pages>(undefined);
  const [letterPages, setLetterPages] = useState<Pages>(undefined);
  const [approving, setApproving] = useState(false);
  const [compileErrors, setCompileErrors] = useState<string[] | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyResult | null>(null);

  const { id, resumeId, coverLetterId } = application;
  const command = applyCommand(id);
  const problems = finalApprovalProblems(reviewStateOf(application));
  const unsaved = unsavedReason(resumeSaveStatus, questionsSaveStatus);
  const isReady = application.status === 'ready';

  // Page counts come from the preview endpoints, which store nothing.
  useEffect(() => {
    let cancelled = false;
    if (!resumeId) return;
    renderResume(resumeId)
      .then((result) => !cancelled && setResumePages(result.ok ? result.pages : null))
      .catch(() => !cancelled && setResumePages(null));
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  useEffect(() => {
    let cancelled = false;
    if (!coverLetterId) return;
    renderCoverLetter(coverLetterId)
      .then((result) => !cancelled && setLetterPages(result.ok ? result.pages : null))
      .catch(() => !cancelled && setLetterPages(null));
    return () => {
      cancelled = true;
    };
  }, [coverLetterId]);

  async function copyCommand(): Promise<void> {
    setCopied(await copyText(command));
  }

  async function handleApprove(): Promise<void> {
    setApproving(true);
    setCompileErrors(null);
    setRequestError(null);
    setCopied(null);
    try {
      const result = await approveApplication(id);
      if (!result.ok) {
        setCompileErrors(
          result.errors.length > 0 ? result.errors : ['A document did not compile.'],
        );
        return;
      }
      onApproved(result.application);
      await copyCommand();
    } catch (error) {
      setRequestError(
        error instanceof ApiError ? error.message : 'Could not approve this application.',
      );
    } finally {
      setApproving(false);
    }
  }

  const stepNumber = (key: ReviewStepKey) => steps.find((step) => step.key === key)?.number;
  // Once ready, the name the snapshot was stored under; before, the name the
  // server will give it.
  const resumeFilename =
    isReady && application.sentPdf
      ? application.sentPdf.filename
      : (application.pdfFilenames.resume ?? '');

  return (
    // The bottom padding lets the last box scroll clear of the fixed
    // "Give feedback" button (FeedbackWidget) on a narrow window.
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6 pb-24">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        {resumeId ? (
          <SummaryRow
            testId="approve-row-resume"
            label="Resume"
            pages={resumePages}
            filename={resumeFilename}
            approved={application.resumeApprovedAt !== null}
            stepNumber={stepNumber('resume')}
            onGoTo={() => onGoTo('resume')}
          />
        ) : null}
        {coverLetterId ? (
          <SummaryRow
            testId="approve-row-coverLetter"
            label="Cover letter"
            pages={letterPages}
            filename={application.pdfFilenames.coverLetter ?? ''}
            approved={application.coverLetterApprovedAt !== null}
            stepNumber={stepNumber('coverLetter')}
            onGoTo={() => onGoTo('coverLetter')}
          />
        ) : null}
        {application.questions.length > 0 ? (
          <QuestionsRow
            application={application}
            stepNumber={stepNumber('questions')}
            onGoTo={() => onGoTo('questions')}
          />
        ) : null}

        <div className="flex flex-col items-center gap-3 pt-2">
          {isReady ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <span className="text-sm font-medium text-success">
                Approved{application.approvedAt ? ` ${formatDate(application.approvedAt)}` : ''} ·
                Ready
              </span>
              <button
                type="button"
                onClick={() => void copyCommand()}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
              >
                Copy command
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={approving || problems.length > 0 || unsaved !== null}
                className="w-full max-w-md rounded-lg border border-success-line bg-success-surface/60 px-6 py-3 text-base font-semibold text-success-ink transition-colors hover:bg-success-surface disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-ink-dim"
              >
                {approving ? 'Approving…' : 'Approve + copy command'}
              </button>
              {problems.length > 0 ? (
                <ul data-testid="approve-problems" className="text-center text-xs text-ink-dim">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
              {problems.length === 0 && unsaved ? (
                <p data-testid="approve-unsaved" className="text-center text-xs text-ink-dim">
                  {unsaved}
                </p>
              ) : null}
            </>
          )}

          {compileErrors ? (
            <div className="w-full rounded-lg border border-danger-line/50 bg-danger-surface/30 p-4 text-sm text-danger-ink">
              <ul className="space-y-1">
                {compileErrors.map((error) => (
                  <li key={error} className="break-words">
                    {error}
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-medium">Nothing was approved.</p>
            </div>
          ) : null}
          {requestError ? <p className="text-sm text-danger">{requestError}</p> : null}

          {copied === 'copied' ? (
            <p
              data-testid="apply-command-copied"
              className="rounded-full border border-line bg-canvas px-5 py-2 font-mono text-sm text-ink"
            >
              Copied: {command}
            </p>
          ) : null}
          {copied === 'unavailable' || copied === 'failed' ? (
            <CopyFallback command={command} onCopy={() => void copyCommand()} />
          ) : null}
        </div>

        {isReady ? (
          <div className="rounded-lg border border-line bg-surface p-4 text-center text-xs text-ink-dim">
            <p>
              Paste into Claude in resumix/agent/. A headed browser opens, fills the approved values
              and stops before Submit. You submit.
            </p>
            <p>Or run /resumix-apply-ready to work through every ready application.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SummaryRowProps {
  testId: string;
  label: string;
  pages: Pages;
  filename: string;
  approved: boolean;
  stepNumber: number | undefined;
  onGoTo: () => void;
}

function pagesText(pages: Pages): string {
  if (pages === undefined) return 'counting pages…';
  if (pages === null) return 'pages unknown';
  return `${pages} ${pages === 1 ? 'page' : 'pages'}`;
}

/** One document about to be sent: its page count, its filename, and
 *  whether that section has been approved. */
function SummaryRow({
  testId,
  label,
  pages,
  filename,
  approved,
  stepNumber,
  onGoTo,
}: SummaryRowProps) {
  const long = typeof pages === 'number' && pages > 1;
  return (
    <div
      data-testid={testId}
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm ${
        approved
          ? 'border-success-line bg-success-surface/20 text-success-ink'
          : 'border-line bg-surface text-ink-dim'
      }`}
    >
      <span className="font-medium">{label}</span>
      <span>·</span>
      {long ? (
        <span className="rounded-full border border-warning-line-strong/60 bg-warning-surface/40 px-2 py-0.5 text-xs font-medium text-warning-ink">
          ⚠ {pagesText(pages)}
        </span>
      ) : (
        <span>{pagesText(pages)}</span>
      )}
      <span>·</span>
      <span className="font-mono text-xs">{filename}</span>
      <span>·</span>
      {approved ? (
        <span>approved ✓</span>
      ) : (
        <button
          type="button"
          onClick={onGoTo}
          className="underline transition-colors hover:text-accent"
        >
          not approved — go to step {stepNumber}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface QuestionsRowProps {
  application: ApplicationDetail;
  stepNumber: number | undefined;
  onGoTo: () => void;
}

/** How many of the form's questions are approved. Only the required ones
 *  gate approval; an optional one left open is left blank (C3, D-047). */
function QuestionsRow({ application, stepNumber, onGoTo }: QuestionsRowProps) {
  const { approved, total, requiredOpen, optionalOpen } = questionProgress(application.questions);
  const done = approved === total;
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        data-testid="approve-row-questions"
        className={`flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm ${
          done
            ? 'border-success-line bg-success-surface/20 text-success-ink'
            : 'border-line bg-surface text-ink-dim'
        }`}
      >
        <span className="font-medium">Questions</span>
        <span>·</span>
        <span>
          {approved} of {total} approved{done ? ' ✓' : ''}
        </span>
        {requiredOpen > 0 ? (
          <>
            <span>—</span>
            <button
              type="button"
              onClick={onGoTo}
              className="underline transition-colors hover:text-accent"
            >
              {requiredOpen} required still open → step {stepNumber}
            </button>
          </>
        ) : null}
      </div>
      {optionalOpen > 0 ? (
        <p data-testid="approve-optional-note" className="text-xs text-ink-dim">
          {optionalOpen === 1
            ? '1 optional question will be left blank.'
            : `${optionalOpen} optional questions will be left blank.`}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The command, selected, for when the Clipboard API is missing or refused.
 *  The Copy button is offered only when there is an API for a fresh click
 *  to try again with. */
function CopyFallback({ command, onCopy }: { command: string; onCopy: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      data-testid="apply-command-fallback"
      className="flex w-full flex-col gap-2 rounded-lg border border-line bg-surface p-4"
    >
      <p className="text-sm text-ink">
        Couldn&apos;t copy automatically — select the command and copy it:
      </p>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          readOnly
          value={command}
          aria-label="Apply command"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-accent"
        />
        {canCopy() ? (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Copy
          </button>
        ) : null}
      </div>
    </div>
  );
}
