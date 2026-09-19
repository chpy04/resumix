'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SaveStatus } from '@/lib/editor/autosave';
import SaveStatusBadge from './SaveStatusBadge';

export type EditorTab = 'content' | 'template';

interface EditorHeaderProps {
  resumeName: string;
  onResumeNameChange: (name: string) => void;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  saveStatus: SaveStatus;
  onRetry: () => void;
  onDownload: () => void;
  downloading: boolean;
  downloadError: string | null;
}

/**
 * Top bar: back link, the resume's own name (editable — global rename via
 * `PATCH /api/resumes/:id`, debounced text autosave), the Content/Template
 * tabs (state lifted here so T9 can add real Template-tab content without
 * touching this file), the combined save-status indicator, and the
 * save-as-PDF-snapshot action.
 */
export default function EditorHeader({
  resumeName,
  onResumeNameChange,
  tab,
  onTabChange,
  saveStatus,
  onRetry,
  onDownload,
  downloading,
  downloadError,
}: EditorHeaderProps) {
  const [localName, setLocalName] = useState(resumeName);

  return (
    <header className="flex flex-col gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="shrink-0 rounded-md border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            ← Resumes
          </Link>
          <input
            value={localName}
            onChange={(event) => {
              setLocalName(event.target.value);
              onResumeNameChange(event.target.value);
            }}
            aria-label="Resume name"
            className="min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold text-[var(--color-ink)] outline-none hover:border-[var(--color-line)] focus:border-[var(--color-accent)]"
          />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <SaveStatusBadge status={saveStatus} onRetry={onRetry} />
          {downloadError ? <span className="text-xs text-red-400">{downloadError}</span> : null}
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            title="Renders the current template + selections, saves a snapshot, and downloads it"
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-[var(--color-canvas)] transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? 'Saving PDF…' : 'Save PDF'}
          </button>
        </div>
      </div>

      <nav className="flex gap-1" role="tablist" aria-label="Editor sections">
        <TabButton active={tab === 'content'} onClick={() => onTabChange('content')}>
          Content
        </TabButton>
        <TabButton active={tab === 'template'} onClick={() => onTabChange('template')}>
          Template
        </TabButton>
      </nav>
    </header>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
          : 'border-transparent text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}
