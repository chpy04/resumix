'use client';

import { useDraggable } from '@dnd-kit/core';
import ApplicationCard from '@/components/applications/ApplicationCard';
import type { ApplicationSummary } from '@/lib/types';

interface DraggableCardProps {
  application: ApplicationSummary;
}

/**
 * A board card you can pick up. The whole card is the handle — there is
 * nothing else on it to aim at — and a 4px activation distance keeps an
 * ordinary click opening the application.
 *
 * Only the listeners are spread, not dnd-kit's `attributes`: they would nest a
 * second `role="button"` inside the card's own, and there is no keyboard
 * sensor registered here anyway (the editor's lists made the same call).
 *
 * Nothing here suppresses the click that ends a drag. dnd-kit's pointer sensor
 * already swallows it with a capture-phase listener on the document, which it
 * removes 50ms after the drop — so a second suppression of our own would eat
 * the *next* genuine click instead.
 */
export default function DraggableCard({ application }: DraggableCardProps) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: application.id });

  return (
    <div ref={setNodeRef} {...listeners} className={isDragging ? 'opacity-40' : undefined}>
      <ApplicationCard application={application} />
    </div>
  );
}
