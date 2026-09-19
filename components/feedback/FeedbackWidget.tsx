'use client';

import { useCallback, useState } from 'react';
import FeedbackDialog, { type FeedbackDraft } from '@/components/feedback/FeedbackDialog';
import { ApiError, submitFeedback, type FeedbackResult } from '@/lib/api-client';
import { prepareScreenshot } from '@/lib/feedback/screenshot-client';

/**
 * The always-present "Give feedback" affordance, mounted once by `AuthGate`
 * so it rides along on every authenticated page without each page having to
 * remember it.
 *
 * Owns the network call and hands `submitting`/`error`/`result` down to the
 * presentational dialog — same split as `ResumeGrid` → `NewResumeDialog`.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  // Bumped to remount the dialog, which is how "Send another" gets a blank
  // form back without the dialog having to reset every field by hand.
  const [formKey, setFormKey] = useState(0);

  const openDialog = useCallback(() => {
    setPageUrl(window.location.href);
    setError(null);
    setResult(null);
    setFormKey((key) => key + 1);
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    if (submitting) return;
    setOpen(false);
  }, [submitting]);

  const reset = useCallback(() => {
    setPageUrl(window.location.href);
    setResult(null);
    setError(null);
    setFormKey((key) => key + 1);
  }, []);

  async function handleSubmit(draft: FeedbackDraft): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const screenshot = draft.screenshot ? await prepareScreenshot(draft.screenshot) : null;
      const filed = await submitFeedback({
        kind: draft.kind,
        description: draft.description,
        url: pageUrl,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
        screenshot,
      });
      setResult(filed);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Your text is still here — try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-haspopup="dialog"
        className="fixed right-4 bottom-4 z-40 flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-ink)] shadow-lg transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
          <path
            d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v7a1.5 1.5 0 0 1-1.5 1.5H6.2L3 14.5v-2.6A1.5 1.5 0 0 1 2 10.5v-7Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        Give feedback
      </button>

      <FeedbackDialog
        key={formKey}
        open={open}
        pageUrl={pageUrl}
        submitting={submitting}
        error={error}
        result={result}
        onSubmit={handleSubmit}
        onReset={reset}
        onClose={closeDialog}
      />
    </>
  );
}
