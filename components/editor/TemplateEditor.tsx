'use client';

import { forwardRef, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * A `<textarea>`-based LaTeX editor: monospace font, Tab-key handling (inserts
 * a literal tab instead of moving focus off the field), and a line-number
 * gutter kept in sync via scroll position. Deliberately not CodeMirror/Monaco
 * — per the task brief, a plain textarea is enough for editing LaTeX here.
 */
const TemplateEditor = forwardRef<HTMLTextAreaElement, TemplateEditorProps>(function TemplateEditor(
  { value, onChange },
  forwardedRef,
) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = useMemo(() => value.split('\n').length, [value]);

  function handleScroll(event: UIEvent<HTMLTextAreaElement>): void {
    setScrollTop(event.currentTarget.scrollTop);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
    onChange(next);
    // Restore the cursor just after the inserted tab on the next tick, once
    // React has re-rendered the (now longer) value into the textarea.
    requestAnimationFrame(() => {
      target.selectionStart = selectionStart + 1;
      target.selectionEnd = selectionStart + 1;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] font-mono text-[12.5px] leading-relaxed">
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="select-none overflow-hidden border-r border-[var(--color-line)] px-2 py-2 text-right text-[var(--color-ink-dim)]"
        style={{ transform: `translateY(-${scrollTop}px)` }}
      >
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <textarea
        ref={forwardedRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        spellCheck={false}
        wrap="off"
        aria-label="Template LaTeX"
        // `whitespace-pre` (no wrapping) keeps one source line == one visual
        // line, which is what lets the gutter's row-per-`\n` count stay
        // aligned with the textarea's own scroll position above.
        className="min-h-0 flex-1 resize-none overflow-auto bg-transparent px-3 py-2 whitespace-pre text-[var(--color-ink)] outline-none"
      />
    </div>
  );
});

export default TemplateEditor;
