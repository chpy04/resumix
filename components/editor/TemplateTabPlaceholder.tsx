'use client';

import type { Template } from '@/lib/types';

interface TemplateTabPlaceholderProps {
  template: Template;
}

/**
 * Left-pane body for the Template tab, until T9 replaces it with the real
 * LaTeX editor (`PATCH /api/templates/:id`, global to every resume). Shows
 * the current template read-only so the tab isn't a dead end while T9 lands.
 * See `docs/agents/t8-seams.md`.
 */
export default function TemplateTabPlaceholder({ template }: TemplateTabPlaceholderProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">Template editor coming soon</p>
        <p className="mt-1 text-xs text-[var(--color-ink-dim)]">
          Editing <span className="text-[var(--color-ink)]">{template.name}</span> will happen here — global to
          every resume, same as the content tab&apos;s edits.
        </p>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--color-ink-dim)]">
        {template.content}
      </pre>
    </div>
  );
}
