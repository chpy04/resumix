'use client';

import Link from 'next/link';
import StatusBadge from '@/components/applications/StatusBadge';
import type { ApplicationDetail } from '@/lib/types';

interface ReviewHeaderProps {
  application: ApplicationDetail;
  summaryOpen: boolean;
  onToggleSummary: () => void;
}

/** The summary's first line, for the header: the full text is one click away. */
function firstLine(text: string | null): string | null {
  const line = text
    ?.split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? null;
}

/**
 * The review page's top bar, the same on every step: the way back to the
 * board, which application this is, where it stands, and what the agent
 * thought of it. The company links to the application's own page, where its
 * fields and files are.
 */
export default function ReviewHeader({
  application,
  summaryOpen,
  onToggleSummary,
}: ReviewHeaderProps) {
  const summary = firstLine(application.agentSummary);
  const hasSummary = summary !== null || Boolean(application.jobDescription?.trim());

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href="/"
          className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
        >
          ← Board
        </Link>
        <h1 className="min-w-0 truncate text-base font-semibold text-ink">
          <Link
            href={`/applications/${application.id}`}
            className="transition-colors hover:text-accent"
            title="Open this application's page"
          >
            {application.company}
          </Link>
          {application.roleTitle ? (
            <span className="text-ink-dim"> · {application.roleTitle}</span>
          ) : null}
        </h1>
        <span data-testid="review-status">
          <StatusBadge status={application.status} />
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {application.fitScore !== null || summary ? (
          <p className="min-w-0 truncate text-xs text-ink-dim" title={summary ?? undefined}>
            {application.fitScore !== null ? (
              <span className="font-medium text-ink">fit {application.fitScore.toFixed(1)}</span>
            ) : null}
            {application.fitScore !== null && summary ? ' — ' : null}
            {summary}
          </p>
        ) : null}
        {hasSummary ? (
          <button
            type="button"
            onClick={onToggleSummary}
            aria-expanded={summaryOpen}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            Summary {summaryOpen ? '▴' : '▾'}
          </button>
        ) : null}
      </div>
    </header>
  );
}
