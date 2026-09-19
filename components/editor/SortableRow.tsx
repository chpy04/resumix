'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode } from 'react';
import DragHandle from './DragHandle';

interface SortableRowProps {
  id: string;
  children: ReactNode;
  className?: string;
}

/**
 * One draggable row inside a `@dnd-kit` `SortableContext`. Renders its own
 * drag handle (first child) so callers never have to wire up
 * `listeners`/`attributes` themselves.
 */
export default function SortableRow({ id, children, className }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`drag-row-${id}`}
      className={`flex items-start gap-1.5 ${isDragging ? 'z-10 opacity-70' : ''} ${className ?? ''}`}
    >
      <DragHandle {...attributes} {...listeners} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
