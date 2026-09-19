'use client';

import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/types';

interface KanbanColumnProps {
  status: ApplicationStatus;
  count: number;
  children: ReactNode;
}

/**
 * One board column, and one drop target. The droppable id *is* the status, so
 * a drop needs no lookup table — `statusForDrop` reads it straight off.
 *
 * The column keeps a minimum height whether or not it holds anything: an
 * empty column you cannot drop into is a worse target than a visible one.
 */
export default function KanbanColumn({ status, count, children }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center justify-between border-b border-line pb-1.5 text-xs font-semibold tracking-wide text-ink-dim uppercase">
        {statusLabel(status)}
        <span className="text-ink-dim/70">{count}</span>
      </h2>
      <div
        ref={setNodeRef}
        data-testid={`kanban-column-${status}`}
        className={`flex min-h-40 flex-col gap-2 rounded-lg border border-dashed p-2 transition-colors ${
          isOver ? 'border-accent bg-surface-2' : 'border-transparent'
        }`}
      >
        {children}
      </div>
    </section>
  );
}
