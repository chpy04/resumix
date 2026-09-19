'use client';

import { forwardRef } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Fuzzy-search input for the resume grid. The keyboard shortcuts that focus
 * this (`/` and cmd+k) are wired up by the parent, which owns the ref.
 */
const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox({ value, onChange }, ref) {
  return (
    <div className="relative w-full max-w-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-dim)]"
      >
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search resumes…"
        aria-label="Search resumes"
        className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-2 pr-16 pl-9 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-dim)] focus:border-[var(--color-accent)]"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-dim)]">
        /
      </kbd>
    </div>
  );
});

export default SearchBox;
