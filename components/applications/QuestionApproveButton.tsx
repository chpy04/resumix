'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';

interface QuestionApproveButtonProps {
  approved: boolean;
  /** It was approved and has since been changed. */
  reopened: boolean;
  /** Why this answer cannot be approved as it stands ("Pick an attachment."),
   *  shown beside the button. */
  problem: string | null;
  /** Why nothing can be approved right now: the status, or a save still in
   *  flight. A tooltip rather than text, since every card shares it. */
  disabledReason: string | null;
  onApprove: () => Promise<void>;
}

/**
 * One question's approval, the questions step's counterpart to
 * `SectionApproveButton`. Once approved it reads as done, and the answer
 * stays editable; an edit brings the button back, and says why (D-047).
 */
export default function QuestionApproveButton({
  approved,
  reopened,
  problem,
  disabledReason,
  onApprove,
}: QuestionApproveButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (approved) {
    return <span className="text-sm font-medium text-success">✓ Approved</span>;
  }

  async function handleClick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onApprove();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve this answer.');
    } finally {
      setBusy(false);
    }
  }

  const note = error ?? (reopened ? 'You changed this after approving it.' : problem);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {note ? (
        <span
          className={`text-xs ${error ? 'text-danger' : reopened ? 'text-warning' : 'text-ink-dim'}`}
        >
          {note}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy || problem !== null || disabledReason !== null}
        title={disabledReason ?? problem ?? undefined}
        className="rounded-md border border-success-line bg-success-surface/30 px-3 py-1.5 text-sm font-medium text-success-ink transition-colors hover:bg-success-surface/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Approving…' : 'Approve'}
      </button>
    </div>
  );
}
