'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AgentSummaryPanel from '@/components/applications/AgentSummaryPanel';
import ApproveStep from '@/components/applications/ApproveStep';
import CoverLetterReviewStep from '@/components/applications/CoverLetterReviewStep';
import QuestionsReviewStep from '@/components/applications/QuestionsReviewStep';
import ResumeReviewStep from '@/components/applications/ResumeReviewStep';
import ReviewHeader from '@/components/applications/ReviewHeader';
import ReviewStepper from '@/components/applications/ReviewStepper';
import {
  ApiError,
  approveApplicationQuestions,
  approveApplicationSection,
  getApplication,
} from '@/lib/api-client';
import { reopenedQuestions } from '@/lib/applications/questions';
import {
  initialStep,
  reopenedSections,
  reviewStateOf,
  reviewSteps,
  sectionApprovalProblem,
  type ReviewSection,
  type ReviewStepKey,
} from '@/lib/applications/review';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { ApplicationDetail, ApplicationFile } from '@/lib/types';

interface ReviewFlowProps {
  applicationId: string;
}

/**
 * The review page (D-044): one application, step by step: its resume, its
 * letter when it has one (C12), its form's questions when it has any
 * (D-047), then final approval.
 *
 * This component owns the application and re-reads it after every approval,
 * every selection write and every letter body write, because a write can
 * clear an approval on the server (C3) and the stepper, the header's status
 * and the buttons all follow from what the server says. Responses that
 * arrive out of order are dropped: only the latest request counts.
 *
 * The resume, letter and questions steps stay mounted while hidden, so
 * switching steps never cuts off an autosave in flight.
 */
export default function ReviewFlow({ applicationId }: ReviewFlowProps) {
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<ReviewStepKey>('resume');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [reopened, setReopened] = useState<ReadonlySet<ReviewSection>>(new Set());
  const [reopenedQuestionIds, setReopenedQuestionIds] = useState<ReadonlySet<string>>(new Set());
  // The resume editor's autosave, which final approval must wait for: the
  // snapshot is rendered from what the server holds.
  const [resumeSaveStatus, setResumeSaveStatus] = useState<SaveStatus>('idle');
  const [questionsSaveStatus, setQuestionsSaveStatus] = useState<SaveStatus>('idle');

  const current = useRef<ApplicationDetail | null>(null);
  const latestRequest = useRef(0);

  /** Takes a fresh copy of the application, noting any approval it lost. */
  const accept = useCallback((next: ApplicationDetail) => {
    const before = current.current;
    current.current = next;
    setApplication(next);
    const lost = before ? reopenedSections(before, next) : [];
    if (lost.length > 0) setReopened((prev) => new Set([...prev, ...lost]));
    const lostQuestions = before ? reopenedQuestions(before.questions, next.questions) : [];
    if (lostQuestions.length > 0) {
      setReopenedQuestionIds((prev) => new Set([...prev, ...lostQuestions]));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = ++latestRequest.current;
    getApplication(applicationId)
      .then((loaded) => {
        if (cancelled || request !== latestRequest.current) return;
        accept(loaded);
        setActive(initialStep(reviewSteps(reviewStateOf(loaded))));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiError ? error.message : 'Could not load this application.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, accept]);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const next = await getApplication(applicationId);
      if (request === latestRequest.current) accept(next);
    } catch {
      // The page keeps what it had; the next save refreshes it again.
    }
  }, [applicationId, accept]);

  /** Approves one section, then moves on to the next step. Throws, for the
   *  button to show, when the server refuses. */
  const approveSection = useCallback(
    async (section: ReviewSection) => {
      const next = await approveApplicationSection(applicationId, section);
      // Anything still in flight was asked before this approval.
      latestRequest.current++;
      accept(next);
      setReopened((prev) => new Set([...prev].filter((s) => s !== section)));
      const steps = reviewSteps(reviewStateOf(next));
      const index = steps.findIndex((step) => step.key === section);
      setActive(steps[index + 1]?.key ?? 'approve');
    },
    [applicationId, accept],
  );

  /** Approves these questions. The answer is the rows, not the
   *  application, so they are merged in and the application re-read. */
  const approveQuestions = useCallback(
    async (ids: string[]) => {
      const approved = await approveApplicationQuestions(applicationId, ids);
      const base = current.current;
      if (base) {
        const byId = new Map(approved.map((question) => [question.id, question]));
        latestRequest.current++;
        accept({ ...base, questions: base.questions.map((q) => byId.get(q.id) ?? q) });
      }
      setReopenedQuestionIds((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      void refresh();
    },
    [applicationId, accept, refresh],
  );

  /** An attachment uploaded from a file question, shown in its picker at
   *  once rather than after the next read. */
  const handleFileUploaded = useCallback(
    (file: ApplicationFile) => {
      const base = current.current;
      if (!base) return;
      latestRequest.current++;
      accept({ ...base, files: [file, ...base.files] });
    },
    [accept],
  );

  const handleApproved = useCallback(
    (next: ApplicationDetail) => {
      latestRequest.current++;
      accept(next);
    },
    [accept],
  );

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load this application.</p>
          <p className="mt-1 text-danger/80">{loadError}</p>
          <Link href="/" className="mt-4 inline-block text-sm text-accent">
            ← Board
          </Link>
        </div>
      </main>
    );
  }

  if (!application) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-dim">
        Loading review…
      </div>
    );
  }

  const state = reviewStateOf(application);
  const steps = reviewSteps(state);
  // A letter unlinked elsewhere takes its step with it.
  const shown = steps.some((step) => step.key === active) ? active : 'approve';

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <ReviewHeader
        application={application}
        summaryOpen={summaryOpen}
        onToggleSummary={() => setSummaryOpen((open) => !open)}
      />
      {summaryOpen ? (
        <div className="max-h-96 shrink-0 overflow-y-auto border-b border-line p-4">
          <AgentSummaryPanel
            agentSummary={application.agentSummary}
            jobDescription={application.jobDescription}
            fitScore={application.fitScore}
          />
        </div>
      ) : null}
      <ReviewStepper steps={steps} active={shown} onSelect={setActive} />
      {application.status === 'proposing' ? (
        <p className="shrink-0 border-b border-line bg-surface-2 px-4 py-2 text-xs text-ink-dim">
          The agent is still working on this one. Look around, but approving waits until it submits
          it for review.
        </p>
      ) : null}

      <div className={shown === 'resume' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <ResumeReviewStep
          application={application}
          blockedBy={sectionApprovalProblem(state, 'resume')}
          reopened={reopened.has('resume')}
          onApprove={() => approveSection('resume')}
          onSelectionsSaved={refresh}
          onSaveStatusChange={setResumeSaveStatus}
          visible={shown === 'resume'}
        />
      </div>
      {application.coverLetterId ? (
        <div className={shown === 'coverLetter' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <CoverLetterReviewStep
            application={{ ...application, coverLetterId: application.coverLetterId }}
            blockedBy={sectionApprovalProblem(state, 'coverLetter')}
            reopened={reopened.has('coverLetter')}
            onApprove={() => approveSection('coverLetter')}
            onBodySaved={refresh}
          />
        </div>
      ) : null}
      {application.questions.length > 0 ? (
        <div className={shown === 'questions' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <QuestionsReviewStep
            application={application}
            blockedBy={sectionApprovalProblem(application, 'questions')}
            reopened={reopenedQuestionIds}
            onApprove={approveQuestions}
            onSaved={refresh}
            onFileUploaded={handleFileUploaded}
            onSaveStatusChange={setQuestionsSaveStatus}
            onNext={() => setActive('approve')}
          />
        </div>
      ) : null}
      {shown === 'approve' ? (
        <ApproveStep
          application={application}
          steps={steps}
          onGoTo={setActive}
          onApproved={handleApproved}
          resumeSaveStatus={resumeSaveStatus}
          questionsSaveStatus={questionsSaveStatus}
        />
      ) : null}
    </div>
  );
}
