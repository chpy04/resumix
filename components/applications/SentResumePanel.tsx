'use client';

import Link from 'next/link';
import type { ApplicationDetail } from '@/lib/types';

interface SentResumePanelProps {
  application: ApplicationDetail;
  onMarkApplied: () => void;
  onDownload: () => void;
  applying: boolean;
  downloading: boolean;
  error: string | null;
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
 * The two resume links, and the button that turns one into the other.
 *
 * Before it is sent, an application points at a live resume you keep editing.
 * Marking it applied renders that resume, snapshots the PDF, and pins the
 * application to those bytes — while keeping the link to the resume itself,
 * so "what did they get?" and "what has that resume become since?" stay two
 * separate, answerable questions (D-031).
 */
export default function SentResumePanel({
  application,
  onMarkApplied,
  onDownload,
  applying,
  downloading,
  error,
}: SentResumePanelProps) {
  const { sentPdf, resumeId } = application;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">What you sent</h2>

      {sentPdf ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink" title={sentPdf.filename}>
            {sentPdf.filename}
          </span>
          <span className="text-xs text-ink-dim">saved {formatDate(sentPdf.createdAt)}</span>
          <button
            type="button"
            data-testid="application-sent-pdf-download"
            onClick={onDownload}
            disabled={downloading}
            className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
          >
            {downloading ? 'Downloading…' : 'Download'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-dim">
          Nothing sent yet. Marking this applied saves a PDF of the linked resume and keeps those
          exact bytes here, whatever you do to the resume afterwards.
        </p>
      )}

      {resumeId ? (
        <Link
          href={`/resume/${resumeId}`}
          className="w-fit text-xs text-accent transition-opacity hover:opacity-80"
        >
          Open the resume this came from →
        </Link>
      ) : (
        <p className="text-xs text-ink-dim">
          No resume linked. You can still mark this applied — it just won&apos;t have a PDF.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="application-mark-applied"
          onClick={onMarkApplied}
          disabled={applying}
          title={
            resumeId
              ? 'Renders the linked resume, stores the PDF, and pins this application to it'
              : 'Marks this applied; no resume is linked, so no PDF is stored'
          }
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? 'Saving PDF…' : sentPdf ? 'Re-send: save a new PDF' : 'Mark as applied'}
        </button>
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
    </section>
  );
}
