'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ResumeSummary } from '@/lib/types';

export interface NewApplicationInput {
  company: string;
  roleTitle: string;
  postingUrl: string;
  /** The resume to clone for this application, or null to start without one. */
  startFromResumeId: string | null;
}

interface NewApplicationDialogProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  /** Offered as starting points; the user's Default is preselected. */
  resumes: ResumeSummary[];
  onSubmit: (input: NewApplicationInput) => void;
  onClose: () => void;
}

/**
 * Logs a new application, and gives it a resume to tailor.
 *
 * Only the company is required, and it does double duty: it names the
 * application and the resume cloned for it. Starting from an existing resume
 * rather than a blank one is the point — last month's tailored resume is
 * usually a better starting point than Default, so it is a dropdown.
 */
export default function NewApplicationDialog({
  open,
  submitting,
  error,
  resumes,
  onSubmit,
  onClose,
}: NewApplicationDialogProps) {
  const [company, setCompany] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [postingUrl, setPostingUrl] = useState('');
  const [startFrom, setStartFrom] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultResumeId = useMemo(
    () => resumes.find((resume) => resume.isDefault)?.id ?? resumes[0]?.id ?? '',
    [resumes],
  );

  useEffect(() => {
    if (open) {
      setCompany('');
      setRoleTitle('');
      setPostingUrl('');
      setStartFrom(defaultResumeId);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open, defaultResumeId]);

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
      startFromResumeId: startFrom === '' ? null : startFrom,
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
          This also creates a resume named after the company, copied from the one you pick.
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

          <label className="flex flex-col gap-1 text-xs text-ink-dim">
            Start its resume from
            <select
              value={startFrom}
              aria-label="Start its resume from"
              disabled={submitting}
              onChange={(event) => setStartFrom(event.target.value)}
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
            >
              {resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.name}
                  {resume.isDefault ? ' (Default)' : ''}
                </option>
              ))}
              <option value="">Don&apos;t create a resume</option>
            </select>
          </label>

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
