'use client';

interface PreviewPanePlaceholderProps {
  resumeId: string;
  templateName: string;
  hasSavedPdf: boolean;
}

/**
 * Stand-in for T9's real PDF preview pane (`POST /api/resumes/:id/render`,
 * rendered live as content/template change). See `docs/agents/t8-seams.md`
 * for the exact props this needs to grow into and where it's mounted.
 *
 * Deliberately owns no state and does no fetching — it's the seam T9
 * replaces wholesale, not a component T9 extends.
 */
export default function PreviewPanePlaceholder({ resumeId, templateName, hasSavedPdf }: PreviewPanePlaceholderProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-10 w-10 text-[var(--color-ink-dim)]">
        <rect x="5" y="3" width="14" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 8H16M8 12H16M8 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div>
        <p className="text-sm font-medium text-[var(--color-ink)]">Live PDF preview coming soon</p>
        <p className="mt-1 max-w-xs text-xs text-[var(--color-ink-dim)]">
          This pane will render <span className="text-[var(--color-ink)]">{templateName}</span> against your
          current selections as you edit.
        </p>
      </div>
      <p className="text-[11px] text-[var(--color-ink-dim)]">
        resume {resumeId.slice(0, 8)}… · {hasSavedPdf ? 'has a saved PDF snapshot' : 'no saved PDF yet'}
      </p>
    </div>
  );
}
