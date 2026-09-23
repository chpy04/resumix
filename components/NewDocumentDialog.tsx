'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

interface NewDocumentDialogProps {
  /** Heading, e.g. "New resume". Also the dialog's accessible name. */
  title: string;
  /** One line under it saying what the new document starts from. */
  description: string;
  open: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/**
 * In-app modal for naming a new document — a resume or a cover letter, both
 * of which are created the same way: type the company, get a copy of your
 * default. Deliberately not `window.prompt()` per spec: it needs to look and
 * behave like the rest of the app (dark theme, focus trap, Escape to close).
 */
export default function NewDocumentDialog({
  title,
  description,
  open,
  submitting,
  error,
  onSubmit,
  onClose,
}: NewDocumentDialogProps) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      // Autofocus once the dialog has mounted into the DOM.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
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

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0 || submitting) return;
    onSubmit(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-document-title"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="new-document-title" className="text-base font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-1 text-sm text-ink-dim">{description}</p>

        <form onSubmit={handleSubmit} className="mt-4">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Company name"
            disabled={submitting}
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />

          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

          <div className="mt-5 flex justify-end gap-2">
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
              disabled={submitting || name.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
