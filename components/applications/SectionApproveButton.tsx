'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';

interface SectionApproveButtonProps {
  /** "resume" or "letter": the button reads "Approve resume". */
  noun: string;
  approved: boolean;
  /** It was approved and has since been changed. */
  reopened: boolean;
  /** Why it cannot be approved in this status, or null when it can. */
  blockedBy: string | null;
  /** An edit is still saving, or failed to: approving now would approve
   *  something other than what is on screen. */
  unsaved: boolean;
  onApprove: () => Promise<void>;
}

/**
 * One section's approval, for the resume and letter steps alike. Once
 * approved it reads as done rather than offering a second click; an edit
 * afterwards brings the button back, and says why it came back (D-044).
 */
export default function SectionApproveButton({
  noun,
  approved,
  reopened,
  blockedBy,
  unsaved,
  onApprove,
}: SectionApproveButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Noun = `${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;

  if (approved) {
    return <span className="text-sm font-medium text-success">✓ {Noun} approved</span>;
  }

  async function handleClick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onApprove();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not approve the ${noun}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error ? <span className="text-xs text-danger">{error}</span> : null}
      {!error && reopened ? (
        <span className="text-xs text-warning">You changed this after approving it.</span>
      ) : null}
      {!error && !reopened && blockedBy ? (
        <span className="text-xs text-ink-dim">{blockedBy}</span>
      ) : null}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy || unsaved || blockedBy !== null}
        title={blockedBy ?? (unsaved ? 'Waiting for your changes to save' : undefined)}
        className="rounded-md border border-success-line bg-success-surface/30 px-3 py-1.5 text-sm font-medium text-success-ink transition-colors hover:bg-success-surface/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Approving…' : `Approve ${noun}`}
      </button>
    </div>
  );
}
