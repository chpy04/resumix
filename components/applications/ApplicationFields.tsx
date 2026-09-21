'use client';

import { APPLICATION_STATUSES, statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus, ResumeSummary } from '@/lib/types';

export interface ApplicationDraft {
  company: string;
  roleTitle: string;
  postingUrl: string;
  notes: string;
}

interface ApplicationFieldsProps {
  draft: ApplicationDraft;
  /** Debounced autosave — the caller sends the whole draft, never one field. */
  onDraftChange: (draft: ApplicationDraft) => void;
  status: ApplicationStatus;
  onStatusChange: (status: ApplicationStatus) => void;
  resumeId: string | null;
  resumes: ResumeSummary[];
  onResumeChange: (resumeId: string | null) => void;
}

const fieldClass =
  'w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent';

/**
 * Everything about an application that is just text. Deliberately flat and
 * mostly optional: applications differ from each other enough that structure
 * gets in the way, so there is one notes box rather than a form (D-032).
 */
export default function ApplicationFields({
  draft,
  onDraftChange,
  status,
  onStatusChange,
  resumeId,
  resumes,
  onResumeChange,
}: ApplicationFieldsProps) {
  function update(patch: Partial<ApplicationDraft>): void {
    onDraftChange({ ...draft, ...patch });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Company
          <input
            type="text"
            value={draft.company}
            onChange={(event) => update({ company: event.target.value })}
            className={fieldClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Role
          <input
            type="text"
            value={draft.roleTitle}
            onChange={(event) => update({ roleTitle: event.target.value })}
            className={fieldClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Link to the posting
        <input
          type="url"
          value={draft.postingUrl}
          onChange={(event) => update({ postingUrl: event.target.value })}
          placeholder="https://…"
          className={fieldClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Status
          <select
            value={status}
            aria-label="Status"
            onChange={(event) => onStatusChange(event.target.value as ApplicationStatus)}
            className={fieldClass}
          >
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-ink-dim">
          Resume
          <select
            value={resumeId ?? ''}
            aria-label="Resume"
            onChange={(event) => onResumeChange(event.target.value || null)}
            className={fieldClass}
          >
            <option value="">No resume linked</option>
            {resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-dim">
        Notes
        <textarea
          value={draft.notes}
          onChange={(event) => update({ notes: event.target.value })}
          rows={10}
          placeholder="Anything worth remembering: who referred you, what the recruiter said, what to prepare."
          className={`${fieldClass} resize-y font-mono`}
        />
      </label>
    </div>
  );
}
