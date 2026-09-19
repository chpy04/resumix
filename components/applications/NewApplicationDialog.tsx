'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

export interface NewApplicationInput {
  company: string;
  roleTitle: string;
  postingUrl: string;
}

interface NewApplicationDialogProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: NewApplicationInput) => void;
  onClose: () => void;
}

/**
 * Logs a new application. Only the company is required — an application is
 * created the moment you see a posting, and everything else (the resume, the
 * cover letter, the notes) gets filled in on the detail page afterwards.
 */
export default function NewApplicationDialog({
  open,
  submitting,
  error,
  onSubmit,
  onClose,
}: NewApplicationDialogProps) {
  const [company, setCompany] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [postingUrl, setPostingUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCompany('');
      setRoleTitle('');
      setPostingUrl('');
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
    const trimmed = company.trim();
    if (trimmed.length === 0 || submitting) return;
    onSubmit({
      company: trimmed,
      roleTitle: roleTitle.trim(),
      postingUrl: postingUrl.trim(),
    });
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
        aria-labelledby="new-application-title"
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="new-application-title" className="text-base font-semibold text-ink">
          New application
        </h2>
        <p className="mt-1 text-sm text-ink-dim">
          Log it now; link a resume and fill in the rest as you go.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <input
            ref={inputRef}
            type="text"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Company"
            aria-label="Company"
            disabled={submitting}
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />
          <input
            type="text"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
            placeholder="Role (optional)"
            aria-label="Role"
            disabled={submitting}
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />
          <input
            type="url"
            value={postingUrl}
            onChange={(event) => setPostingUrl(event.target.value)}
            placeholder="Link to the posting (optional)"
            aria-label="Link to the posting"
            disabled={submitting}
            className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
          />

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="mt-2 flex justify-end gap-2">
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
              disabled={submitting || company.trim().length === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:opacity-50"
            >
              {submitting ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
