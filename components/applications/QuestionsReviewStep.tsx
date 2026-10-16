'use client';

import { useCallback, useEffect, useState } from 'react';
import ProfileAnswersGroup, {
  type ProfileRow,
} from '@/components/applications/ProfileAnswersGroup';
import QuestionCard from '@/components/applications/QuestionCard';
import type { AnswerDraft } from '@/components/applications/QuestionAnswerInput';
import SavedAnswerRow from '@/components/applications/SavedAnswerRow';
import SaveStatusBadge from '@/components/editor/SaveStatusBadge';
import { useAutosaveRegistry } from '@/components/editor/useAutosaveRegistry';
import { setQuestionRemembered, updateApplicationQuestion } from '@/lib/api-client';
import {
  approvalProblem,
  questionProgress,
  rememberProblem,
  reviewGroups,
  sameAnswer,
} from '@/lib/applications/questions';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { ApplicationDetail, ApplicationFile, ApplicationQuestion } from '@/lib/types';

interface QuestionsReviewStepProps {
  application: ApplicationDetail;
  /** Why nothing can be approved in this status; null in Needs review. */
  blockedBy: string | null;
  /** Questions an edit has unapproved since they were approved. */
  reopened: ReadonlySet<string>;
  /** Approves exactly these ids, then refreshes. Throws to show. */
  onApprove: (ids: string[]) => Promise<void>;
  /** A write landed, and may have cleared an approval. */
  onSaved: () => void;
  onFileUploaded: (file: ApplicationFile) => void;
  onSaveStatusChange: (status: SaveStatus) => void;
  onNext: () => void;
}

/** One queue per question, so its saves land in the order they were made. */
function channel(question: ApplicationQuestion): string {
  return `question:${question.id}`;
}

/** And one for its "remember" box, which is a separate write (D-048). */
function rememberChannel(question: ApplicationQuestion): string {
  return `remember:${question.id}`;
}

/**
 * Step 3: the application form's questions, each answered and approved on
 * its own (D-047). Profile answers come first, collapsed, to approve in
 * bulk; then the ones the agent answered from Chris's saved answers, which
 * arrived approved and show as one line each until he edits one (D-048);
 * then every other question in the form's order.
 *
 * Answers autosave, one queue per question: typing waits 500ms, and a
 * discrete pick (a radio, a toggle, a file) is sent at once. What is on
 * screen is a local draft once Chris has touched a question, and the
 * server's answer until then. A question's Approve waits until the server
 * holds exactly what is on screen, since approving is of the saved answer.
 * Ticking "remember this answer" is sent at once, on a queue of its own.
 */
export default function QuestionsReviewStep({
  application,
  blockedBy,
  reopened,
  onApprove,
  onSaved,
  onFileUploaded,
  onSaveStatusChange,
  onNext,
}: QuestionsReviewStepProps) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, AnswerDraft>>>({});
  const [remembered, setRemembered] = useState<Readonly<Record<string, boolean>>>({});
  // Saved answers opened for editing stay open, approved again or not.
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const { getController, retryAll, statusOf, status } = useAutosaveRegistry();

  useEffect(() => {
    onSaveStatusChange(status);
  }, [status, onSaveStatusChange]);

  const change = useCallback(
    (question: ApplicationQuestion, next: AnswerDraft, immediate: boolean) => {
      setDrafts((prev) => ({ ...prev, [question.id]: next }));
      const controller = getController<AnswerDraft>(
        channel(question),
        async (value) => {
          // The whole draft every time: the queue coalesces by replacement.
          await updateApplicationQuestion(question.id, value);
          onSaved();
        },
        500,
      );
      controller.schedule(next);
      if (immediate) controller.flushNow();
    },
    [getController, onSaved],
  );

  const remember = useCallback(
    (question: ApplicationQuestion, next: boolean) => {
      setRemembered((prev) => ({ ...prev, [question.id]: next }));
      const controller = getController<boolean>(
        rememberChannel(question),
        async (value) => {
          await setQuestionRemembered(question.id, value);
          onSaved();
        },
        0,
      );
      controller.schedule(next);
      controller.flushNow();
    },
    [getController, onSaved],
  );

  const liveFiles = application.files.filter((file) => !file.isArchived);
  const progress = questionProgress(application.questions);
  const { profile, saved, rest } = reviewGroups(application.questions);

  /** Everything a card shows that follows from the server and the draft. */
  function view(question: ApplicationQuestion) {
    const draft = drafts[question.id] ?? {
      answerMode: question.answerMode,
      answer: question.answer,
    };
    const saving = statusOf(channel(question));
    const unsaved = saving === 'saving' || saving === 'error' || !sameAnswer(draft, question);
    return {
      draft,
      unsaved,
      approved: question.approvedAt !== null && !unsaved,
      reopened: reopened.has(question.id) || (question.approvedAt !== null && unsaved),
      problem: approvalProblem({ ...question, ...draft }, liveFiles),
      disabledReason: blockedBy ?? (unsaved ? 'Waiting for your changes to save' : null),
      remember: {
        checked: remembered[question.id] ?? question.savedAnswerId !== null,
        problem: rememberProblem({ ...question, ...draft }),
        busy: unsaved,
      },
    };
  }

  const profileRows: ProfileRow[] = profile.map((question) => {
    const shown = view(question);
    return {
      question,
      draft: shown.draft,
      unsaved: shown.unsaved,
      approved: shown.approved,
      reopened: shown.reopened,
      problem: shown.problem,
      remember: shown.remember,
    };
  });

  function card(question: ApplicationQuestion) {
    const shown = view(question);
    return (
      <QuestionCard
        key={question.id}
        question={question}
        draft={shown.draft}
        files={liveFiles}
        applicationId={application.id}
        approved={shown.approved}
        reopened={shown.reopened}
        problem={shown.problem}
        disabledReason={shown.disabledReason}
        remember={shown.remember}
        onChange={(next, immediate) => change(question, next, immediate)}
        onRemember={(next) => remember(question, next)}
        onApprove={() => onApprove([question.id])}
        onRedraft={async (note) => {
          await updateApplicationQuestion(question.id, { redraftNote: note });
          onSaved();
        }}
        onFileUploaded={onFileUploaded}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6 pb-24">
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <p data-testid="questions-progress" className="text-sm text-ink">
              Questions · {progress.approved} of {progress.total} approved
              {progress.requiredOpen > 0 ? (
                <span className="text-ink-dim"> · {progress.requiredOpen} required still open</span>
              ) : null}
            </p>
            <SaveStatusBadge status={status} onRetry={retryAll} />
          </div>

          {profileRows.length > 0 ? (
            <ProfileAnswersGroup
              rows={profileRows}
              files={liveFiles}
              applicationId={application.id}
              blockedBy={blockedBy}
              onChange={change}
              onRemember={remember}
              onApprove={onApprove}
              onFileUploaded={onFileUploaded}
            />
          ) : null}

          {saved.map((question) => {
            const shown = view(question);
            if (!shown.approved || editing.has(question.id)) return card(question);
            return (
              <SavedAnswerRow
                key={question.id}
                question={question}
                draft={shown.draft}
                remember={shown.remember}
                onRemember={(next) => remember(question, next)}
                onEdit={() => setEditing((prev) => new Set([...prev, question.id]))}
              />
            );
          })}

          {rest.map(card)}
        </div>
      </div>

      {/* `pr-48` keeps the button out from under the fixed "Give feedback"
          button (FeedbackWidget), as the other steps' footers do. */}
      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface py-3 pr-48 pl-4">
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Next: Approve →
        </button>
      </footer>
    </div>
  );
}
