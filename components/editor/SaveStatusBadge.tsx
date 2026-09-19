'use client';

import type { SaveStatus } from '@/lib/editor/autosave';

interface SaveStatusBadgeProps {
  status: SaveStatus;
  onRetry?: () => void;
}

/**
 * The one honest autosave indicator for the whole editor — never a save
 * button. Aggregated across every autosave channel on the page (selections,
 * content field edits, the resume name) via `combineStatuses`.
 */
export default function SaveStatusBadge({ status, onRetry }: SaveStatusBadgeProps) {
  if (status === 'idle') return null;

  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3 w-3 animate-spin">
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
        Saving…
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded border border-red-800 bg-red-950/30 px-2 py-1 text-xs text-red-300 transition-colors hover:bg-red-900/40"
      >
        Save failed — retry
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-dim)]">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-green-500">
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Saved
    </span>
  );
}
