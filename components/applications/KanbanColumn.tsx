'use client';

import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/types';

interface KanbanColumnProps {
  status: ApplicationStatus;
  count: number;
  /** False for the flow columns, which only the review flow fills (C3). */
  acceptsDrops: boolean;
  /** A card is in the air somewhere on the board. */
  dragging: boolean;
  children: ReactNode;
}

/**
 * One board column, and one drop target. The droppable id *is* the status, so
 * a drop needs no lookup table — `statusForDrop` reads it straight off.
 *
 * A flow column is still registered as a droppable, just one whose drops
 * `statusForDrop` turns into nothing. Disabling it instead would let
 * `closestCorners` hand the drop to the nearest column that *does* accept,
 * so letting go over Ready would land the card in Interviewing (D-041). It
 * dims while a card is in the air and never lights up, so it does not look
 * like somewhere to aim.
 *
 * The column fills whatever height the board gives it, empty or not: an empty
 * column you cannot drop into is a worse target than a visible one, and a
 * column that grows with its contents would push the drop zones off screen.
 * Cards scroll within it instead.
 */
export default function KanbanColumn({
  status,
  count,
  acceptsDrops,
  dragging,
  children,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const highlighted = acceptsDrops && isOver;

  return (
    <section
      className={`flex min-h-0 flex-col gap-2 transition-opacity ${
        dragging && !acceptsDrops ? 'opacity-50' : ''
      }`}
    >
      <h2 className="flex shrink-0 items-center justify-between border-b border-line pb-1.5 text-xs font-semibold tracking-wide text-ink-dim uppercase">
        {statusLabel(status)}
        <span className="text-ink-dim/70">{count}</span>
      </h2>
      <div
        ref={setNodeRef}
        data-testid={`kanban-column-${status}`}
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-lg border border-dashed p-2 transition-colors ${
          highlighted ? 'border-accent bg-surface-2' : 'border-transparent'
        }`}
      >
        {children}
      </div>
    </section>
  );
}
