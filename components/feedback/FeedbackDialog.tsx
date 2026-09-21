'use client';

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import type { FeedbackKind } from '@/lib/feedback/issue';
import { firstImageFile } from '@/lib/feedback/drag';
import { formatBytes } from '@/lib/feedback/screenshot-client';
import type { FeedbackResult } from '@/lib/api-client';

export interface FeedbackDraft {
  kind: FeedbackKind;
  description: string;
  screenshot: File | null;
}

interface FeedbackDialogProps {
  open: boolean;
  /** Captured when the dialog opened, so it still reports the page the user
   *  was looking at even if something navigates underneath. */
  pageUrl: string;
  /** Owned by `FeedbackWidget`, because a screenshot can also arrive by
   *  being dropped on the button while this panel is closed. */
  screenshot: File | null;
  onScreenshotChange: (screenshot: File | null) => void;
  submitting: boolean;
  error: string | null;
  result: FeedbackResult | null;
  onSubmit: (draft: FeedbackDraft) => void;
  onReset: () => void;
  onClose: () => void;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * The feedback form, as a popover anchored above the button rather than a
 * modal over the whole page.
 *
 * Non-modal on purpose: filing a bug means describing what is on screen, so
 * covering the screen with a dimmed overlay hides the evidence. Dismissal is
 * therefore the popover contract — Escape, Cancel, or a click anywhere else
 * — and the outside-click half lives in `FeedbackWidget`, which is the only
 * component that can see both this panel and the button at once.
 *
 * Presentation only: `FeedbackWidget` owns the network call and passes
 * `submitting`/`error`/`result` back in, mirroring how `ResumeGrid` drives
 * `NewDocumentDialog`.
 */
export default function FeedbackDialog({
  open,
  pageUrl,
  screenshot,
  onScreenshotChange,
  submitting,
  error,
  result,
  onSubmit,
  onReset,
  onClose,
}: FeedbackDialogProps) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [description, setDescription] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fresh form every time it opens; a stale draft from last week's bug is
  // never what you want to file. The screenshot is excluded — it belongs to
  // the widget, which may have just set it from a drop on the button.
  useEffect(() => {
    if (!open) return undefined;
    setKind('bug');
    setDescription('');
    setDragging(false);
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Object URLs are revoked on replacement/unmount, or the blob leaks for
  // the lifetime of the document.
  useEffect(() => {
    if (!screenshot) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(screenshot);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  if (!open) return null;

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = firstImageFile(event.dataTransfer.files);
    if (file) onScreenshotChange(file);
  }

  // Cmd-Shift-Ctrl-4 puts a screenshot straight on the clipboard; pasting it
  // anywhere in the panel should attach it without a round trip through disk.
  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const file = firstImageFile(event.clipboardData?.files);
    if (file) {
      event.preventDefault();
      onScreenshotChange(file);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = description.trim();
    if (trimmed.length === 0 || submitting) return;
    onSubmit({ kind, description: trimmed, screenshot });
  }

  return (
    <div
      role="dialog"
      aria-labelledby="feedback-title"
      onPaste={handlePaste}
      // Sits above the button (bottom-4 + its height) and never taller than
      // the viewport, so the form is still usable on a laptop screen.
      className="fixed right-4 bottom-16 z-50 flex max-h-[calc(100dvh-6rem)] w-88 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-2xl"
    >
      <h2 id="feedback-title" className="text-sm font-semibold text-ink">
        {result ? 'Feedback filed' : 'Give feedback'}
      </h2>

      {result ? (
        <SuccessPanel result={result} onReset={onReset} onClose={onClose} />
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-dim">
            Files a GitHub issue so it can be picked up and fixed.
          </p>

          <form onSubmit={handleSubmit} className="mt-3">
            <fieldset disabled={submitting}>
              <legend className="sr-only">Feedback type</legend>
              <div className="flex gap-2">
                <KindOption value="bug" label="Bug" checked={kind === 'bug'} onSelect={setKind} />
                <KindOption
                  value="feature"
                  label="Feature request"
                  checked={kind === 'feature'}
                  onSelect={setKind}
                />
              </div>

              <textarea
                ref={textareaRef}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder={
                  kind === 'bug'
                    ? 'What happened, and what did you expect instead?'
                    : 'What would you like to be able to do?'
                }
                className="mt-2 w-full resize-y rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
              />

              <ScreenshotField
                screenshot={screenshot}
                previewUrl={previewUrl}
                dragging={dragging}
                onDrop={handleDrop}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onPick={(files) => {
                  const file = firstImageFile(files);
                  if (file) onScreenshotChange(file);
                }}
                onClear={() => onScreenshotChange(null)}
              />

              <p className="mt-2 truncate text-xs text-ink-dim" title={pageUrl}>
                Page: <span className="text-ink">{pageUrl}</span>
              </p>
            </fieldset>

            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || description.trim().length === 0}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

interface KindOptionProps {
  value: FeedbackKind;
  label: string;
  checked: boolean;
  onSelect: (kind: FeedbackKind) => void;
}

/** A real radio input (visually hidden) behind a drawn circle: exclusivity,
 *  arrow-key navigation, and the `radio` a11y role all come for free. */
function KindOption({ value, label, checked, onSelect }: KindOptionProps) {
  return (
    <label
      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
        checked
          ? 'border-accent bg-surface-2 text-ink'
          : 'border-line text-ink-dim hover:border-accent'
      }`}
    >
      <input
        type="radio"
        name="feedback-kind"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-accent' : 'border-line'
        }`}
      >
        {checked ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
      </span>
      {label}
    </label>
  );
}

interface ScreenshotFieldProps {
  screenshot: File | null;
  previewUrl: string | null;
  dragging: boolean;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onPick: (files: FileList | null) => void;
  onClear: () => void;
}

function ScreenshotField({
  screenshot,
  previewUrl,
  dragging,
  onDrop,
  onDragOver,
  onDragLeave,
  onPick,
  onClear,
}: ScreenshotFieldProps) {
  if (screenshot) {
    return (
      <div className="mt-2 flex items-center gap-3 rounded-md border border-line bg-surface-2 p-2">
        {previewUrl ? (
          // A blob: URL from a local File; next/image would have nothing to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Screenshot preview"
            className="h-10 w-14 rounded object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-ink">{screenshot.name}</p>
          <p className="text-xs text-ink-dim">{formatBytes(screenshot.size)}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <label
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-3 text-center text-xs transition-colors ${
        dragging
          ? 'border-accent bg-surface-2 text-accent'
          : 'border-line text-ink-dim hover:border-accent'
      }`}
    >
      <input
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        data-testid="feedback-screenshot-input"
        onChange={(event) => onPick(event.target.files)}
        className="sr-only"
      />
      <span>Drop a screenshot here</span>
      <span className="mt-0.5 text-ink-dim">or click to browse · ⌘V to paste</span>
    </label>
  );
}

function SuccessPanel({
  result,
  onReset,
  onClose,
}: {
  result: FeedbackResult;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-sm text-ink-dim">
        Opened{' '}
        <a href={result.url} target="_blank" rel="noreferrer" className="text-accent underline">
          issue #{result.number}
        </a>
        .
      </p>
      {result.screenshotUploaded ? null : (
        <p className="mt-2 text-sm text-warning">
          The screenshot could not be uploaded — the issue says so.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2"
        >
          Send another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas"
        >
          Done
        </button>
      </div>
    </div>
  );
}
