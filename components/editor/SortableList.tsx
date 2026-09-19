'use client';

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ReactNode } from 'react';

interface SortableListProps {
  /** Every id currently rendered inside, in display order. */
  ids: string[];
  /** Called with the full new id order after a drag ends in a new position. */
  onReorder: (ids: string[]) => void;
  children: ReactNode;
  className?: string;
}

/**
 * One independent drag-and-drop list. Each section (experiences, a given
 * experience's bullets, a skill row's skills, ...) gets its own
 * `SortableList` — there's no cross-list dragging in this app, so a fresh
 * `DndContext` per list is simpler than one shared context threading
 * container ids through.
 */
export default function SortableList({ ids, onReorder, children, className }: SortableListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}
