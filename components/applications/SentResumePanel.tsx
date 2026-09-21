'use client';

import Link from 'next/link';
import type { ApplicationDetail } from '@/lib/types';

interface SentResumePanelProps {
  application: ApplicationDetail;
  /** The linked resume's name, for display. Null when none is linked. */
  resumeName: string | null;
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
 * The resume side of an application: the live resume you tailor, the frozen
 * PDF saved against it, and the button that declares it sent.
 *
 * The two are separate on purpose. Editing the resume changes nothing here
 * until you save it back from the editor; marking it applied then moves the
 * application off the pipeline board and into the Applied table (D-032).
 */
export default function SentResumePanel({
  application,
  resumeName,
  onMarkApplied,
  onDownload,
  applying,
  downloading,
  error,
}: SentResumePanelProps) {
  const { sentPdf, resumeId, status, appliedAt } = application;
  const editHref = `/resume/${resumeId}?application=${application.id}`;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Resume</h2>

      {resumeId ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink" title={resumeName ?? undefined}>
            {resumeName ?? 'Linked resume'}
          </span>
          <Link
            href={editHref}
            data-testid="application-edit-resume"
            className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            Tailor it →
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-dim">
          No resume linked. Pick one on the left, or mark this applied as it is — an application
          logged after the fact doesn&apos;t need one.
        </p>
      )}

      {sentPdf ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-sm text-ink-dim" title={sentPdf.filename}>
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
        <p className="text-xs text-ink-dim">
          No PDF saved to this application yet. Tailoring the resume and saving from the editor pins
          one here, and it stays those exact bytes however the resume changes afterwards.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {status === 'applied' ? (
          <p className="text-xs text-ink-dim">
            Applied {appliedAt ? formatDate(appliedAt) : ''} — in the Applied table now. Change the
            status on the left if they reply.
          </p>
        ) : (
          <button
            type="button"
            data-testid="application-mark-applied"
            onClick={onMarkApplied}
            disabled={applying}
            title={
              resumeId
                ? 'Saves the resume PDF if you have not already, and moves this to the Applied table'
                : 'Moves this to the Applied table; no resume is linked, so no PDF is stored'
            }
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {applying ? 'Marking applied…' : 'Mark as applied'}
          </button>
        )}
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
    </section>
  );
}
