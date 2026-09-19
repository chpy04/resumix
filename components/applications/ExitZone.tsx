'use client';

import { useDroppable } from '@dnd-kit/core';
import { statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus } from '@/lib/types';

interface ExitZoneProps {
  status: ApplicationStatus;
  hint: string;
}

/**
 * One of the two ways off the board, shown under the columns only while a
 * card is in the air.
 *
 * They are hidden the rest of the time on purpose: `applied` and `rejected`
 * are not places you go looking, they are where a card goes to leave. Giving
 * them permanent columns is exactly what this layout is avoiding (D-033).
 */
export default function ExitZone({ status, hint }: ExitZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-exit-${status}`}
      className={`flex min-h-24 flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
        isOver ? 'border-accent bg-surface-2 text-ink' : 'border-line bg-surface/50 text-ink-dim'
      }`}
    >
      <span className="text-sm font-semibold">{statusLabel(status)}</span>
      <span className="mt-0.5 text-xs">{hint}</span>
    </div>
  );
}
