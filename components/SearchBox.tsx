'use client';

import type { Ref } from 'react';

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** What is being searched. Also the accessible name, so it must say which
   *  list this box filters — there is one per page. */
  label?: string;
  placeholder?: string;
  /** Owned by the parent, which wires up the `/` and cmd+k focus shortcuts. */
  ref?: Ref<HTMLInputElement>;
}

/**
 * Fuzzy-search input for a list page — the resume grid and the applications
 * board both use it. The keyboard shortcuts that focus this (`/` and cmd+k)
 * are wired up by the parent, which owns the ref.
 */
export default function SearchBox({
  value,
  onChange,
  label = 'Search resumes',
  placeholder = 'Search resumes…',
  ref,
}: SearchBoxProps) {
  return (
    <div className="relative w-full max-w-sm">
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-dim"
      >
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-md border border-line bg-surface py-2 pr-16 pl-9 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-accent"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-dim">
        /
      </kbd>
    </div>
  );
}
