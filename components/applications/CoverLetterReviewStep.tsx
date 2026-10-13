'use client';

import Link from 'next/link';
import SectionApproveButton from '@/components/applications/SectionApproveButton';
import CoverLetterEditor from '@/components/cover-letters/CoverLetterEditor';
import PreviewPane from '@/components/editor/PreviewPane';
import { renderCoverLetter } from '@/lib/api-client';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { ApplicationDetail, CoverLetter } from '@/lib/types';

interface CoverLetterReviewStepProps {
  application: ApplicationDetail & { coverLetterId: string };
  blockedBy: string | null;
  reopened: boolean;
  onApprove: () => Promise<void>;
  /** A body write landed, and may have cleared the approval. */
  onBodySaved: () => void;
}

/**
 * Step 2: the letter's text, as plain text, beside its live PDF (D-046).
 * The letter editor itself in review mode, rather than a copy of it, as the
 * resume step does: editing here changes this application's letter and
 * nothing else.
 *
 * A letter with no `%%BODY%%` line has no plain text to edit, so the step
 * shows what it compiles to and sends the LaTeX to the letter's own page.
 */
export default function CoverLetterReviewStep({
  application,
  blockedBy,
  reopened,
  onApprove,
  onBodySaved,
}: CoverLetterReviewStepProps) {
  const { coverLetterId } = application;
  const approved = application.coverLetterApprovedAt !== null;

  const approveButton = (unsaved: boolean) => (
    <SectionApproveButton
      noun="letter"
      approved={approved}
      reopened={reopened}
      blockedBy={blockedBy}
      unsaved={unsaved}
      onApprove={onApprove}
    />
  );

  return (
    <CoverLetterEditor
      coverLetterId={coverLetterId}
      review={{
        onBodySaved,
        actions: (saveStatus: SaveStatus) =>
          approveButton(saveStatus === 'saving' || saveStatus === 'error'),
        latexOnly: (letter: CoverLetter) => (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 gap-3 p-3">
              <section className="flex w-2/5 shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                <h2 className="truncate text-sm font-semibold text-ink" title={letter.name}>
                  {letter.name}
                </h2>
                <p className="text-xs text-ink-dim">
                  This letter has no %%BODY%% line, so it can only be edited as LaTeX.
                </p>
                <Link
                  href={`/cover-letter/${letter.id}?application=${application.id}`}
                  className="self-start rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
                >
                  Edit letter →
                </Link>
              </section>
              <div className="min-h-0 flex-1 overflow-hidden">
                {/* The pane reads `render` through a ref, so a fresh closure
                    each render costs nothing; it compiles the saved letter. */}
                <PreviewPane renderKey={letter.id} render={() => renderCoverLetter(letter.id)} />
              </div>
            </div>

            {/* `pr-48` keeps the button out from under the fixed "Give
                feedback" button (FeedbackWidget), as the resume step's
                footer does. */}
            <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface py-3 pr-48 pl-4">
              {approveButton(false)}
            </footer>
          </div>
        ),
      }}
    />
  );
}
