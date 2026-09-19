'use client';

import { useRef } from 'react';
import type { SaveStatus } from '@/lib/editor/autosave';
import type { Template } from '@/lib/types';
import { GlobalEditBadge } from './atoms';
import SaveStatusBadge from './SaveStatusBadge';
import TemplateEditor from './TemplateEditor';

interface TemplateTabProps {
  template: Template;
  onContentChange: (content: string) => void;
  saveStatus: SaveStatus;
  onRetry: () => void;
}

/** The four `<<TOKEN>>`s the renderer understands — see docs/TEMPLATE_TOKENS.md. */
const TOKENS: { token: string; description: string }[] = [
  { token: 'EXPERIENCES', description: 'Selected experiences, in order, each with its selected bullets' },
  { token: 'PROJECTS', description: 'Selected projects, in order, each with its selected bullets' },
  { token: 'SKILLS_TOP', description: 'Selected skill rows marked "top" (e.g. Technical Skills)' },
  { token: 'SKILLS_BOTTOM', description: 'Selected skill rows marked "bottom" (e.g. Additional Information)' },
];

/**
 * Template tab body: a LaTeX editor bound to `template.content`. Editing the
 * template is a **global** change — `PATCH /api/templates/:id` affects every
 * resume that references it, same conceptual rule as editing a bullet on the
 * Content tab (see `GlobalEditBadge`). The live preview picks up keystrokes
 * immediately via `render`'s `templateOverride`; this component only owns
 * persisting them (debounced, via the `onContentChange` callback lifted into
 * `ResumeEditor`).
 */
export default function TemplateTab({ template, onContentChange, saveStatus, onRetry }: TemplateTabProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertToken(token: string): void {
    const textarea = textareaRef.current;
    const snippet = `<<${token}>>`;
    if (!textarea) {
      onContentChange(`${template.content}${snippet}`);
      return;
    }
    const { selectionStart, selectionEnd, value } = textarea;
    const next = `${value.slice(0, selectionStart)}${snippet}${value.slice(selectionEnd)}`;
    onContentChange(next);
    const cursor = selectionStart + snippet.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = cursor;
      textarea.selectionEnd = cursor;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <GlobalEditBadge label="Editing this template changes every resume that uses it" />
          <p className="truncate text-sm font-medium text-[var(--color-ink)]">
            {template.name} <span className="font-normal text-[var(--color-ink-dim)]">— global to every resume</span>
          </p>
        </div>
        <SaveStatusBadge status={saveStatus} onRetry={onRetry} />
      </div>

      <div className="shrink-0 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5">
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-[var(--color-ink-dim)] uppercase">
          Tokens — click to insert at cursor
        </p>
        <div className="flex flex-wrap gap-1.5">
          {TOKENS.map(({ token, description }) => (
            <button
              key={token}
              type="button"
              title={description}
              onClick={() => insertToken(token)}
              className="rounded border border-[var(--color-line)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              {`<<${token}>>`}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-dim)]">
          Wrap a section in{' '}
          <code className="font-mono text-[var(--color-ink)]">{'<<IF:TOKEN>>'}</code>…
          <code className="font-mono text-[var(--color-ink)]">{'<<ENDIF>>'}</code> so it disappears
          when nothing in it is selected. Without it, deselecting a whole section leaves an empty
          LaTeX list and the compile fails.
        </p>
      </div>

      <TemplateEditor ref={textareaRef} value={template.content} onChange={onContentChange} />
    </div>
  );
}
