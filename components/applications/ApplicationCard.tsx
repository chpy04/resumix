'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, downloadApplicationPdf } from '@/lib/api-client';
import type { ApplicationSummary } from '@/lib/types';

interface ApplicationCardProps {
  application: ApplicationSummary;
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
 * One application in the board. The card navigates to the detail page; the
 * download button is a separate hit target that stops propagation, and hands
 * back the PDF that was actually sent rather than the resume's current state.
 */
export default function ApplicationCard({ application }: ApplicationCardProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const sent = application.sentPdf;

  function handleNavigate(): void {
    router.push(`/applications/${application.id}`);
  }

  async function handleDownload(event: React.MouseEvent): Promise<void> {
    event.stopPropagation();
    if (downloading || !sent) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadApplicationPdf(application.id);
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      data-testid={`application-card-${application.id}`}
      role="button"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleNavigate();
        }
      }}
      className="group flex cursor-grab flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent hover:bg-surface-2 focus:outline-none active:cursor-grabbing"
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-ink" title={application.company}>
          {application.company}
        </h3>
        {application.roleTitle ? (
          <p className="truncate text-xs text-ink-dim" title={application.roleTitle}>
            {application.roleTitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-dim">
          {application.appliedAt
            ? `Applied ${formatDate(application.appliedAt)}`
            : `Added ${formatDate(application.createdAt)}`}
        </span>
        {sent ? (
          <button
            type="button"
            data-testid="application-download-button"
            onClick={handleDownload}
            disabled={downloading}
            title={`Download ${sent.filename} — the PDF this application was sent with`}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {downloading ? 'Downloading…' : 'PDF'}
          </button>
        ) : null}
      </div>

      {downloadError ? <p className="text-[11px] text-danger">{downloadError}</p> : null}
      {application.isArchived ? (
        <span className="inline-block w-fit rounded bg-surface-2 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-dim uppercase">
          Archived
        </span>
      ) : null}
    </div>
  );
}
