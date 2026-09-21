'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, downloadCoverLetterPdf } from '@/lib/api-client';
import type { CoverLetterSummary } from '@/lib/types';

interface CoverLetterCardProps {
  letter: CoverLetterSummary;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter.format(date);
}

/**
 * One letter in the library grid — the resume card's sibling, minus the
 * "no saved PDF yet" state. There is no snapshot to be missing: the
 * download always compiles the current text, so the button is live from the
 * moment the letter exists (D-035).
 */
export default function CoverLetterCard({ letter }: CoverLetterCardProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function handleNavigate(): void {
    router.push(`/cover-letter/${letter.id}`);
  }

  async function handleDownload(event: React.MouseEvent): Promise<void> {
    event.stopPropagation();
    if (downloading) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadCoverLetterPdf(letter.id);
    } catch (error) {
      // A 400 here is "this letter does not compile", not a transport fault.
      setDownloadError(error instanceof ApiError ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      data-testid={`cover-letter-card-${letter.id}`}
      role="button"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleNavigate();
        }
      }}
      className={`group relative flex h-36 cursor-pointer flex-col justify-between rounded-lg border p-4 text-left transition-colors focus:outline-none ${
        letter.isDefault
          ? 'border-accent bg-surface-2 hover:bg-surface-2/80'
          : 'border-line bg-surface hover:border-accent hover:bg-surface-2'
      }`}
    >
      <div className="min-w-0">
        {letter.isDefault ? (
          <span className="mb-1 inline-block rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-canvas uppercase">
            Default
          </span>
        ) : null}
        {letter.isArchived ? (
          <span className="mb-1 ml-1 inline-block rounded bg-surface px-1.5 py-0.5 text-[10px] tracking-wide text-ink-dim uppercase">
            Archived
          </span>
        ) : null}
        <h3 className="truncate text-sm font-semibold text-ink" title={letter.name}>
          {letter.name}
        </h3>
        <p className="mt-1 text-xs text-ink-dim">Created {formatDate(letter.createdAt)}</p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs">
          {downloadError ? <span className="text-danger">{downloadError}</span> : null}
        </span>
        <button
          type="button"
          data-testid="cover-letter-download-button"
          onClick={handleDownload}
          disabled={downloading}
          title="Compile this letter and download the PDF"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {downloading ? (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className="h-3.5 w-3.5 animate-spin"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="42"
                strokeDashoffset="14"
              />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
              <path
                d="M12 4V15M12 15L8 11M12 15L16 11M5 18H19"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
