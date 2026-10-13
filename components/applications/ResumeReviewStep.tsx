'use client';

import SectionApproveButton from '@/components/applications/SectionApproveButton';
import ResumeEditor from '@/components/editor/ResumeEditor';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { ApplicationDetail } from '@/lib/types';

interface ResumeReviewStepProps {
  application: ApplicationDetail;
  /** Why a section cannot be approved in this status; null in Needs review. */
  blockedBy: string | null;
  reopened: boolean;
  onApprove: () => Promise<void>;
  /** A selection write landed, and may have cleared the approval. */
  onSelectionsSaved: () => void;
  onSaveStatusChange: (status: SaveStatus) => void;
  /** Whether this step is the one showing. */
  visible: boolean;
}

/**
 * Step 1: the resume editor itself, in review mode, rather than a copy of
 * it. Ticking changes this application's resume, editing text changes the
 * library, exactly as on `/resume/:id`; the agent's pick is badged and can
 * be restored.
 */
export default function ResumeReviewStep({
  application,
  blockedBy,
  reopened,
  onApprove,
  onSelectionsSaved,
  onSaveStatusChange,
  visible,
}: ResumeReviewStepProps) {
  if (!application.resumeId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-ink-dim">
        This application has no resume. Link one on its page first.
      </div>
    );
  }

  return (
    <ResumeEditor
      resumeId={application.resumeId}
      review={{
        proposedSelection: application.proposedSelection,
        onSelectionsSaved,
        onSaveStatusChange,
        visible,
        actions: (saveStatus) => (
          <SectionApproveButton
            noun="resume"
            approved={application.resumeApprovedAt !== null}
            reopened={reopened}
            blockedBy={blockedBy}
            unsaved={saveStatus === 'saving' || saveStatus === 'error'}
            onApprove={onApprove}
          />
        ),
      }}
    />
  );
}
