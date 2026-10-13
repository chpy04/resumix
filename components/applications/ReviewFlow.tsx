'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AgentSummaryPanel from '@/components/applications/AgentSummaryPanel';
import ApproveStep from '@/components/applications/ApproveStep';
import CoverLetterReviewStep from '@/components/applications/CoverLetterReviewStep';
import ResumeReviewStep from '@/components/applications/ResumeReviewStep';
import ReviewHeader from '@/components/applications/ReviewHeader';
import ReviewStepper from '@/components/applications/ReviewStepper';
import {
  ApiError,
  approveApplicationSection,
  getApplication,
  getCoverLetter,
} from '@/lib/api-client';
import {
  initialStep,
  reopenedSections,
  reviewSteps,
  sectionApprovalProblem,
  type ReviewSection,
  type ReviewStepKey,
} from '@/lib/applications/review';
import type { ApplicationDetail } from '@/lib/types';

interface ReviewFlowProps {
  applicationId: string;
}

/**
 * The review page (D-044): one application, step by step: its resume, its
 * letter when it has one (C12), then final approval.
 *
 * This component owns the application and re-reads it after every approval
 * and every selection write, because a write can clear an approval on the
 * server (C3) and the stepper, the header's status and the buttons all
 * follow from what the server says. Responses that arrive out of order are
 * dropped: only the latest request counts.
 *
 * The resume and letter steps stay mounted while hidden, so switching steps
 * never cuts off an autosave in flight.
 */
export default function ReviewFlow({ applicationId }: ReviewFlowProps) {
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [letterName, setLetterName] = useState<string | null>(null);
  const [active, setActive] = useState<ReviewStepKey>('resume');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [reopened, setReopened] = useState<ReadonlySet<ReviewSection>>(new Set());

  const current = useRef<ApplicationDetail | null>(null);
  const latestRequest = useRef(0);

  /** Takes a fresh copy of the application, noting any approval it lost. */
  const accept = useCallback((next: ApplicationDetail) => {
    const before = current.current;
    current.current = next;
    setApplication(next);
    const lost = before ? reopenedSections(before, next) : [];
    if (lost.length > 0) setReopened((prev) => new Set([...prev, ...lost]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const request = ++latestRequest.current;
    getApplication(applicationId)
      .then((loaded) => {
        if (cancelled || request !== latestRequest.current) return;
        accept(loaded);
        setActive(initialStep(reviewSteps(loaded)));
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

  const coverLetterId = application?.coverLetterId ?? null;
  useEffect(() => {
    let cancelled = false;
    if (!coverLetterId) return;
    getCoverLetter(coverLetterId)
      .then((letter) => !cancelled && setLetterName(letter.name))
      .catch(() => {
        // The name is a label; the step still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [coverLetterId]);

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
      const steps = reviewSteps(next);
      const index = steps.findIndex((step) => step.key === section);
      setActive(steps[index + 1]?.key ?? 'approve');
    },
    [applicationId, accept],
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

  const steps = reviewSteps(application);
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
          blockedBy={sectionApprovalProblem(application, 'resume')}
          reopened={reopened.has('resume')}
          onApprove={() => approveSection('resume')}
          onSelectionsSaved={refresh}
        />
      </div>
      {application.coverLetterId ? (
        <div className={shown === 'coverLetter' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <CoverLetterReviewStep
            application={{ ...application, coverLetterId: application.coverLetterId }}
            letterName={letterName}
            blockedBy={sectionApprovalProblem(application, 'coverLetter')}
            reopened={reopened.has('coverLetter')}
            onApprove={() => approveSection('coverLetter')}
          />
        </div>
      ) : null}
      {shown === 'approve' ? (
        <ApproveStep
          application={application}
          letterName={letterName}
          steps={steps}
          onGoTo={setActive}
          onApproved={handleApproved}
        />
      ) : null}
    </div>
  );
}
