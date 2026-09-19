'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, downloadResumePdf } from '@/lib/api-client';
import type { ResumeSummary } from '@/lib/types';

interface ResumeCardProps {
  resume: ResumeSummary;
  /** Visually distinguishes the Default resume from the rest. */
  isDefault?: boolean;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter.format(date);
}

/**
 * A single resume in the grid. The whole card navigates to the editor;
 * the download button is a separate hit target that stops propagation so
 * it doesn't also trigger navigation.
 */
export default function ResumeCard({ resume, isDefault = false }: ResumeCardProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const hasSavedPdf = resume.latestPdf !== null;

  function handleNavigate(): void {
    router.push(`/resume/${resume.id}`);
  }

  async function handleDownload(event: React.MouseEvent): Promise<void> {
    event.stopPropagation();
    if (downloading || !hasSavedPdf) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadResumePdf(resume.id);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      data-testid={`resume-card-${resume.id}`}
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
        isDefault
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-2)]/80'
          : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]'
      }`}
    >
      <div className="min-w-0">
        {isDefault ? (
          <span className="mb-1 inline-block rounded bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-canvas)] uppercase">
            Default
          </span>
        ) : null}
        <h3 className="truncate text-sm font-semibold text-[var(--color-ink)]" title={resume.name}>
          {resume.name}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-ink-dim)]">Created {formatDate(resume.createdAt)}</p>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-ink-dim)]">
          {downloadError ? <span className="text-red-400">{downloadError}</span> : null}
        </span>
        <button
          type="button"
          data-testid="resume-download-button"
          onClick={handleDownload}
          disabled={!hasSavedPdf || downloading}
          title={
            hasSavedPdf
              ? `Download ${resume.latestPdf!.filename}`
              : 'No saved PDF yet — open this resume and save once to enable downloads.'
          }
          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-line)] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--color-line)] disabled:hover:text-[var(--color-ink-dim)]"
        >
          {downloading ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 animate-spin">
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
