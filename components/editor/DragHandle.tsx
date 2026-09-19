'use client';

import type { HTMLAttributes } from 'react';

/**
 * Purely presentational drag handle — the actual dnd-kit listeners/attributes
 * are spread onto it by the caller (`SortableRow`). Kept obvious per the
 * design brief ("Drag handles should be obvious").
 */
export default function DragHandle(props: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      className="flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-ink-dim hover:text-accent active:cursor-grabbing"
      {...props}
    >
      <svg aria-hidden="true" viewBox="0 0 12 20" fill="currentColor" className="h-4 w-3">
        <circle cx="3" cy="3" r="1.4" />
        <circle cx="9" cy="3" r="1.4" />
        <circle cx="3" cy="10" r="1.4" />
        <circle cx="9" cy="10" r="1.4" />
        <circle cx="3" cy="17" r="1.4" />
        <circle cx="9" cy="17" r="1.4" />
      </svg>
    </button>
  );
}
