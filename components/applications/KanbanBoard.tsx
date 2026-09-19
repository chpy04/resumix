'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import ApplicationCard from '@/components/applications/ApplicationCard';
import DraggableCard from '@/components/applications/DraggableCard';
import ExitZone from '@/components/applications/ExitZone';
import KanbanColumn from '@/components/applications/KanbanColumn';
import { EXIT_STATUSES, groupByStatus, statusForDrop } from '@/lib/applications/board';
import type { ApplicationStatus, ApplicationSummary } from '@/lib/types';

interface KanbanBoardProps {
  applications: ApplicationSummary[];
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}

const EXIT_HINTS: Record<string, string> = {
  applied: 'Sent — moves it to the Applied tab',
  rejected: 'Over — moves it to the Applied tab',
};

/**
 * The pipeline, as a board you can drag things around.
 *
 * Columns are the live statuses; the two exit zones under them appear only
 * while a card is in the air, because `applied` and `rejected` are where a
 * card *goes*, not somewhere you browse (D-033). Dropping is the only gesture
 * — there is no ordering within a column to persist, since an application
 * carries no sort_order.
 *
 * One `DndContext` for the whole board, unlike the editor's per-list
 * contexts: cross-column dragging is the entire point here.
 */
export default function KanbanBoard({ applications, onStatusChange }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const columns = groupByStatus(applications);
  const active = applications.find((application) => application.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveId(null);
    const { active: dragged, over } = event;
    if (!over) return;

    const application = applications.find((candidate) => candidate.id === String(dragged.id));
    if (!application) return;

    const next = statusForDrop(application.status, String(over.id));
    if (next) onStatusChange(application.id, next);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      // The exit zones mount mid-drag, so droppables have to be measured
      // continuously rather than once at drag start.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((column) => (
          <KanbanColumn
            key={column.status}
            status={column.status}
            count={column.applications.length}
          >
            {column.applications.map((application) => (
              <DraggableCard key={application.id} application={application} />
            ))}
          </KanbanColumn>
        ))}
      </div>

      {activeId ? (
        <div className="mt-4 grid grid-cols-2 gap-4">
          {EXIT_STATUSES.map((status) => (
            <ExitZone key={status} status={status} hint={EXIT_HINTS[status] ?? ''} />
          ))}
        </div>
      ) : null}

      <DragOverlay dropAnimation={null}>
        {active ? <ApplicationCard application={active} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
