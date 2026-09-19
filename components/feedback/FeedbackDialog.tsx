'use client';

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import type { FeedbackKind } from '@/lib/feedback/issue';
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
  submitting: boolean;
  error: string | null;
  result: FeedbackResult | null;
  onSubmit: (draft: FeedbackDraft) => void;
  onReset: () => void;
  onClose: () => void;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * The feedback form. Presentation only — `FeedbackWidget` owns the network
 * call and passes `submitting`/`error`/`result` back in, mirroring how
 * `ResumeGrid` drives `NewResumeDialog`.
 */
export default function FeedbackDialog({
  open,
  pageUrl,
  submitting,
  error,
  result,
  onSubmit,
  onReset,
  onClose,
}: FeedbackDialogProps) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fresh form every time it opens; a stale draft from last week's bug is
  // never what you want to file.
  useEffect(() => {
    if (!open) return undefined;
    setKind('bug');
    setDescription('');
    setScreenshot(null);
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

  function acceptFile(file: File | undefined | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    setScreenshot(file);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  // Cmd-Shift-Ctrl-4 puts a screenshot straight on the clipboard; pasting it
  // anywhere in the dialog should attach it without a round trip through disk.
  function handlePaste(event: ClipboardEvent<HTMLDivElement>): void {
    const file = event.clipboardData?.files?.[0];
    if (file) {
      event.preventDefault();
      acceptFile(file);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onPaste={handlePaste}
        className="w-full max-w-md rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-2xl"
      >
        <h2 id="feedback-title" className="text-base font-semibold text-[var(--color-ink)]">
          {result ? 'Feedback filed' : 'Give feedback'}
        </h2>

        {result ? (
          <SuccessPanel result={result} onReset={onReset} onClose={onClose} />
        ) : (
          <>
            <p className="mt-1 text-sm text-[var(--color-ink-dim)]">
              Files a GitHub issue so it can be picked up and fixed.
            </p>

            <form onSubmit={handleSubmit} className="mt-4">
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
                  rows={5}
                  placeholder={
                    kind === 'bug'
                      ? 'What happened, and what did you expect instead?'
                      : "What would you like to be able to do?"
                  }
                  className="mt-3 w-full resize-y rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
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
                  onPick={acceptFile}
                  onClear={() => setScreenshot(null)}
                />

                <p className="mt-3 truncate text-xs text-[var(--color-ink-dim)]" title={pageUrl}>
                  Page: <span className="text-[var(--color-ink)]">{pageUrl}</span>
                </p>
              </fieldset>

              {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || description.trim().length === 0}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-canvas)] transition-opacity disabled:opacity-50"
                >
                  {submitting ? 'Sending…' : 'Send feedback'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
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
      className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-ink)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)]'
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
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-[var(--color-accent)]' : 'border-[var(--color-line)]'
        }`}
      >
        {checked ? <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" /> : null}
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
  onPick: (file: File | undefined | null) => void;
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
      <div className="mt-3 flex items-center gap-3 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] p-2">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL from a
          // local File; next/image would have nothing to optimise.
          <img src={previewUrl} alt="Screenshot preview" className="h-12 w-16 rounded object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-[var(--color-ink)]">{screenshot.name}</p>
          <p className="text-xs text-[var(--color-ink-dim)]">{formatBytes(screenshot.size)}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
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
      className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-4 text-center text-xs transition-colors ${
        dragging
          ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)] text-[var(--color-accent)]'
          : 'border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-accent)]'
      }`}
    >
      <input
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        data-testid="feedback-screenshot-input"
        onChange={(event) => onPick(event.target.files?.[0])}
        className="sr-only"
      />
      <span>Drop a screenshot here</span>
      <span className="mt-0.5 text-[var(--color-ink-dim)]">or click to browse · ⌘V to paste</span>
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
      <p className="text-sm text-[var(--color-ink-dim)]">
        Opened{' '}
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--color-accent)] underline"
        >
          issue #{result.number}
        </a>
        .
      </p>
      {result.screenshotUploaded ? null : (
        <p className="mt-2 text-sm text-amber-400">
          The screenshot could not be uploaded — the issue says so.
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          Send another
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-canvas)]"
        >
          Done
        </button>
      </div>
    </div>
  );
}
