'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import SectionApproveButton from '@/components/applications/SectionApproveButton';
import PreviewPane from '@/components/editor/PreviewPane';
import { renderCoverLetter } from '@/lib/api-client';
import type { ApplicationDetail } from '@/lib/types';

interface CoverLetterReviewStepProps {
  application: ApplicationDetail & { coverLetterId: string };
  /** The letter's own name; null until it has loaded. */
  letterName: string | null;
  blockedBy: string | null;
  reopened: boolean;
  onApprove: () => Promise<void>;
}

/**
 * Step 2: the letter, compiled, with a way to its editor. The letter is
 * still one LaTeX document, edited on its own page; this step shows what
 * that document compiles to and approves it.
 */
export default function CoverLetterReviewStep({
  application,
  letterName,
  blockedBy,
  reopened,
  onApprove,
}: CoverLetterReviewStepProps) {
  const { coverLetterId } = application;
  const render = useCallback(() => renderCoverLetter(coverLetterId), [coverLetterId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <section className="flex w-2/5 shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="truncate text-sm font-semibold text-ink" title={letterName ?? undefined}>
            {letterName ?? 'Cover letter'}
          </h2>
          <p className="text-xs text-ink-dim">This letter is LaTeX for now.</p>
          <Link
            href={`/cover-letter/${coverLetterId}?application=${application.id}`}
            className="self-start rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            Edit letter →
          </Link>
        </section>
        <div className="min-h-0 flex-1 overflow-hidden">
          <PreviewPane renderKey={coverLetterId} render={render} />
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-line bg-surface px-4 py-3">
        <SectionApproveButton
          noun="letter"
          approved={application.coverLetterApprovedAt !== null}
          reopened={reopened}
          blockedBy={blockedBy}
          unsaved={false}
          onApprove={onApprove}
        />
      </footer>
    </div>
  );
}
