'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  downloadCoverLetterPdf,
  getCoverLetter,
  renderCoverLetter,
  updateCoverLetter,
} from '@/lib/api-client';
import { combineStatuses, createAutosave, type SaveStatus } from '@/lib/editor/autosave';
import PreviewPane from '@/components/editor/PreviewPane';
import SaveStatusBadge from '@/components/editor/SaveStatusBadge';
import TemplateEditor from '@/components/editor/TemplateEditor';
import type { CoverLetter } from '@/lib/types';

interface CoverLetterEditorProps {
  coverLetterId: string;
  /** Present when opened from an application
   *  (`/cover-letter/:id?application=:id`) — it only changes where back
   *  goes. There is nothing to save *to* the application: the link is
   *  already the record, so editing here is immediately what will be sent
   *  (D-035). */
  applicationId?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; letter: CoverLetter };

/**
 * The cover letter editor: LaTeX on the left, live PDF on the right.
 *
 * Deliberately a much smaller thing than `ResumeEditor`. A resume editor
 * exists because a resume is assembled — selections, ordering, a template,
 * a snapshot on save. A cover letter is one string, so this is a textarea
 * with autosave and a preview, and the "save" button is a download (D-035).
 *
 * Editing here is *not* a global edit, which is the opposite of everything
 * on the resume side: each letter is its own copy and belongs to whichever
 * application holds it.
 */
export default function CoverLetterEditor({
  coverLetterId,
  applicationId,
}: CoverLetterEditorProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [nameStatus, setNameStatus] = useState<SaveStatus>('idle');
  const [contentStatus, setContentStatus] = useState<SaveStatus>('idle');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', letter: await getCoverLetter(coverLetterId) });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load this cover letter.',
      });
    }
  }, [coverLetterId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Two channels, same reason the application editor has two: a full LaTeX
   *  document is a big payload and debounces longer than a name does. */
  const nameSave = useMemo(
    () =>
      createAutosave<string>({
        debounceMs: 500,
        save: async (name) => {
          await updateCoverLetter(coverLetterId, { name });
        },
        onStatusChange: setNameStatus,
      }),
    [coverLetterId],
  );

  const contentSave = useMemo(
    () =>
      createAutosave<string>({
        debounceMs: 1000,
        save: async (content) => {
          await updateCoverLetter(coverLetterId, { content });
        },
        onStatusChange: setContentStatus,
      }),
    [coverLetterId],
  );

  const content = state.status === 'ready' ? state.letter.content : '';

  const handleContentChange = useCallback(
    (next: string) => {
      setState((prev) =>
        prev.status !== 'ready' ? prev : { ...prev, letter: { ...prev.letter, content: next } },
      );
      contentSave.schedule(next);
    },
    [contentSave],
  );

  // The preview compiles what is on screen, not what is stored — the
  // `contentOverride` trick the Template tab uses, for the same reason: a
  // 1s autosave debounce must not make the preview a second behind.
  const renderPreview = useCallback(
    () => renderCoverLetter(coverLetterId, content),
    [coverLetterId, content],
  );

  // -- Resizable divider, the same cheap recipe `ResumeEditor` uses --------
  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      setSplitPercent(Math.min(75, Math.max(25, pct)));
    }
    function handleMouseUp(): void {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.removeProperty('cursor');
      }
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadCoverLetterPdf(coverLetterId);
    } catch (error) {
      // 400 here means the *saved* text does not compile, which the preview
      // has already been saying in red for a while.
      setDownloadError(error instanceof ApiError ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-ink-dim">
        Loading cover letter…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-sm rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load this cover letter.</p>
          <p className="mt-1 text-danger/80">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 rounded-md border border-danger-line-strong px-3 py-1.5 text-sm text-danger-ink-strong transition-colors hover:bg-danger-line/30"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { letter } = state;
  const backHref = applicationId ? `/applications/${applicationId}` : '/cover-letters';
  const backLabel = applicationId ? '← Application' : '← Cover letters';

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            {backLabel}
          </Link>
          <input
            defaultValue={letter.name}
            onChange={(event) => nameSave.schedule(event.target.value)}
            aria-label="Cover letter name"
            className="min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold text-ink outline-none hover:border-line focus:border-accent"
          />
          {letter.isDefault ? (
            <span
              title="Every new cover letter is copied from this one"
              className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-canvas uppercase"
            >
              Default
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <SaveStatusBadge
            status={combineStatuses([nameStatus, contentStatus])}
            onRetry={() => {
              nameSave.retry();
              contentSave.retry();
            }}
          />
          {downloadError ? <span className="text-xs text-danger">{downloadError}</span> : null}
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            title="Compiles the saved letter and downloads the PDF"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-canvas transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? 'Downloading…' : 'Download PDF'}
          </button>
        </div>
      </header>

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          <div className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-line bg-surface p-4">
            <p className="shrink-0 text-xs text-ink-dim">
              The whole letter, as LaTeX. Unlike a resume this text belongs to this letter alone —
              editing it changes nothing else.
            </p>
            <TemplateEditor
              value={content}
              onChange={handleContentChange}
              ariaLabel="Cover letter LaTeX"
            />
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          className="w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent"
        />

        <div style={{ width: `${100 - splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          <PreviewPane renderKey={content} render={renderPreview} />
        </div>
      </div>
    </div>
  );
}
