'use client';

import type { ReviewStep, ReviewStepKey } from '@/lib/applications/review';

interface ReviewStepperProps {
  steps: ReviewStep[];
  active: ReviewStepKey;
  onSelect: (key: ReviewStepKey) => void;
}

/**
 * The steps across the top. Every one is clickable, done or not: the order
 * is the suggested one, not a gate, and the gate itself is final approval.
 * Done is green, the open step has the accent outline.
 */
export default function ReviewStepper({ steps, active, onSelect }: ReviewStepperProps) {
  return (
    <nav
      aria-label="Review steps"
      className="flex shrink-0 flex-wrap gap-2 border-b border-line bg-canvas px-4 py-2"
    >
      {steps.map((step) => {
        const isActive = step.key === active;
        const tone = step.done
          ? 'border-success-line bg-success-surface/20 text-success-ink'
          : 'border-line bg-surface text-ink-dim';
        return (
          <button
            key={step.key}
            type="button"
            data-testid={`review-step-${step.key}`}
            aria-current={isActive ? 'step' : undefined}
            onClick={() => onSelect(step.key)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-accent ${tone} ${
              isActive ? 'outline-2 outline-offset-1 outline-accent' : ''
            }`}
          >
            {step.number} {step.label}
            {step.done ? ' – ok' : ''}
          </button>
        );
      })}
    </nav>
  );
}
