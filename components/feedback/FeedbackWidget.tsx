'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import FeedbackDialog, { type FeedbackDraft } from '@/components/feedback/FeedbackDialog';
import { ApiError, submitFeedback, type FeedbackResult } from '@/lib/api-client';
import { firstImageFile, isFileDrag } from '@/lib/feedback/drag';
import { prepareScreenshot } from '@/lib/feedback/screenshot-client';

/**
 * The always-present "Give feedback" affordance, mounted once by `AuthGate`
 * so it rides along on every authenticated page without each page having to
 * remember it.
 *
 * The button is also the screenshot dropzone: ⌘⇧4 leaves a PNG on the
 * desktop, and dragging it onto the button opens the form with the image
 * already attached, which is the shortest path from "that looks wrong" to a
 * filed issue.
 *
 * Owns the network call and hands `submitting`/`error`/`result` down to the
 * presentational panel — same split as `ResumeGrid` → `NewDocumentDialog`. It
 * also owns the screenshot itself, since that can arrive on the button while
 * the panel is closed.
 */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  // A file is being dragged somewhere over the page, and over the button
  // specifically. The first drives the "you can drop it here" hint.
  const [fileOverPage, setFileOverPage] = useState(false);
  const [fileOverButton, setFileOverButton] = useState(false);
  // Bumped to remount the panel, which is how "Send another" gets a blank
  // form back without the panel having to reset every field by hand.
  const [formKey, setFormKey] = useState(0);
  // Wraps both the button and the panel, so an outside click can be told
  // from a click on either of them.
  const rootRef = useRef<HTMLDivElement>(null);

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
    setScreenshot(null);
    setFormKey((key) => key + 1);
  }, []);

  // Dismiss on a click anywhere else on the site. `pointerdown` rather than
  // `click` so the panel goes away as the user reaches for whatever they
  // clicked, and so a drag that starts outside and ends inside still counts
  // as outside. Not `useOnClickOutside`-style on the panel alone: the button
  // must be excluded too, or clicking it would close and immediately reopen.
  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeDialog();
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open, closeDialog]);

  // Watch for a file being dragged anywhere over the page, for two reasons:
  // the button can light up as a target the user did not know existed, and
  // a drop that *misses* the button gets swallowed instead of navigating the
  // browser away to the raw image — which would throw away whatever the user
  // was about to report on.
  useEffect(() => {
    // dragenter/dragleave fire per element crossed, so a naive boolean
    // flickers off every time the cursor passes over a child. Count depth.
    let depth = 0;

    function handleDragEnter(event: DragEvent): void {
      if (!isFileDrag(event.dataTransfer)) return;
      depth += 1;
      setFileOverPage(true);
    }

    function handleDragOver(event: DragEvent): void {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
    }

    function handleDragLeave(event: DragEvent): void {
      if (!isFileDrag(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setFileOverPage(false);
    }

    function handleDrop(event: DragEvent): void {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      depth = 0;
      setFileOverPage(false);
      setFileOverButton(false);
    }

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  function handleButtonDragOver(event: ReactDragEvent<HTMLButtonElement>): void {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileOverButton(true);
  }

  function handleButtonDrop(event: ReactDragEvent<HTMLButtonElement>): void {
    event.preventDefault();
    setFileOverButton(false);
    const file = firstImageFile(event.dataTransfer.files);
    if (!file) return;
    setScreenshot(file);
    // Dropping on an already-open panel just swaps the image; reopening
    // would remount it and throw away whatever has been typed.
    if (!open) openDialog();
  }

  async function handleSubmit(draft: FeedbackDraft): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const prepared = draft.screenshot ? await prepareScreenshot(draft.screenshot) : null;
      const filed = await submitFeedback({
        kind: draft.kind,
        description: draft.description,
        url: pageUrl,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
        screenshot: prepared,
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
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => (open ? closeDialog() : openDialog())}
        onDragOver={handleButtonDragOver}
        onDragLeave={() => setFileOverButton(false)}
        onDrop={handleButtonDrop}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Fixed, so the visible label can change during a drag without the
        // e2e suite or a screen reader losing track of what this button is.
        aria-label="Give feedback"
        className={`fixed right-4 bottom-4 z-40 flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium shadow-lg transition-colors ${
          fileOverButton
            ? 'border-accent bg-surface-2 text-accent ring-2 ring-accent/50'
            : fileOverPage
              ? 'border-dashed border-accent bg-surface text-accent'
              : 'border-line bg-surface text-ink hover:border-accent hover:text-accent'
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
          <path
            d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v7a1.5 1.5 0 0 1-1.5 1.5H6.2L3 14.5v-2.6A1.5 1.5 0 0 1 2 10.5v-7Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
        {fileOverPage ? 'Drop screenshot' : 'Give feedback'}
      </button>

      <FeedbackDialog
        key={formKey}
        open={open}
        pageUrl={pageUrl}
        screenshot={screenshot}
        onScreenshotChange={setScreenshot}
        submitting={submitting}
        error={error}
        result={result}
        onSubmit={handleSubmit}
        onReset={reset}
        onClose={closeDialog}
      />
    </div>
  );
}
