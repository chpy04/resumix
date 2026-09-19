'use client';

/**
 * Small, shared, presentation-only pieces used across the content-pane
 * sections. Nothing here talks to the network — see `ResumeEditor.tsx` for
 * the data/autosave wiring that owns the callbacks passed in.
 */

interface SelectToggleProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

/** The on/off-this-resume toggle. Large hit target, obvious checked state —
 *  this is the single most-clicked control in the app. */
export function SelectToggle({ checked, onChange, label }: SelectToggleProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-canvas)]'
          : 'border-[var(--color-line)] bg-transparent text-transparent hover:border-[var(--color-accent)]'
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-3 w-3">
        <path d="M3 8.5L6.2 11.5L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Marks an affordance as a global content edit, per the task's most
 *  important conceptual rule: reordering/selecting is per-resume, but
 *  editing/archiving/creating content changes it for every resume. */
export function GlobalEditBadge({ label = 'Edits here apply to every resume' }: { label?: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-[var(--color-line)] text-[9px] text-[var(--color-ink-dim)]"
    >
      ⊕
    </span>
  );
}

export function ArchivedBadge() {
  return (
    <span className="inline-block shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--color-ink-dim)] uppercase">
      Archived
    </span>
  );
}

interface ArchiveButtonProps {
  isArchived: boolean;
  onClick: () => void;
  title?: string;
}

/** Archiving replaces deletion everywhere — there is no delete affordance. */
export function ArchiveButton({ isArchived, onClick, title }: ArchiveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? (isArchived ? 'Unarchive (global)' : 'Archive (global) — there is no delete')}
      className="shrink-0 rounded border border-[var(--color-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
    >
      {isArchived ? 'Unarchive' : 'Archive'}
    </button>
  );
}

interface ChevronProps {
  expanded: boolean;
  onClick: () => void;
  label: string;
}

export function ExpandChevron({ expanded, onClick, label }: ChevronProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={label}
      className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
      >
        <path d="M5 3L11 8L5 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
