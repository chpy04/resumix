'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  downloadCoverLetterPdf,
  getCoverLetter,
  renderCoverLetter,
  updateCoverLetter,
} from '@/lib/api-client';
import { combineStatuses, createAutosave, type SaveStatus } from '@/lib/editor/autosave';
import { takesPlainBody } from '@/lib/render/cover-letter';
import CoverLetterBodyField from '@/components/cover-letters/CoverLetterBodyField';
import { TabButton } from '@/components/editor/atoms';
import PreviewPane from '@/components/editor/PreviewPane';
import SaveStatusBadge from '@/components/editor/SaveStatusBadge';
import TemplateEditor from '@/components/editor/TemplateEditor';
import type { CoverLetter } from '@/lib/types';

/** What the review page's letter step adds to the editor (D-044, D-046). */
export interface CoverLetterReviewMode {
  /** Called each time a body write lands, since it may have cleared this
   *  application's approval of the letter. */
  onBodySaved: () => void;
  /** The step's own buttons, in the footer. They get the save status so an
   *  approval can wait for the edit it is meant to cover. */
  actions: (saveStatus: SaveStatus) => ReactNode;
  /** What the step shows instead, for a letter with no `%%BODY%%` line:
   *  there is no plain text to edit, and the LaTeX is not edited here. */
  latexOnly: (letter: CoverLetter) => ReactNode;
}

interface CoverLetterEditorProps {
  coverLetterId: string;
  /** Present when opened from an application
   *  (`/cover-letter/:id?application=:id`) — it only changes where back
   *  goes. There is nothing to save *to* the application: the link is
   *  already the record, so editing here is immediately what will be sent
   *  (D-035). */
  applicationId?: string;
  /** Present inside the review page: the editor fills its step rather than
   *  the screen, edits only the body, and gains a footer. */
  review?: CoverLetterReviewMode;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; letter: CoverLetter };

type LetterTab = 'body' | 'latex';

/**
 * The cover letter editor: the letter on the left, live PDF on the right.
 *
 * Deliberately a much smaller thing than `ResumeEditor`. A resume editor
 * exists because a resume is assembled — selections, ordering, a template,
 * a snapshot on save. A cover letter is two strings, so this is two text
 * fields with autosave and a preview, and the "save" button is a download
 * (D-035).
 *
 * A letter with a `%%BODY%%` line, or a body, is edited as plain text on the
 * Body tab, with its LaTeX shell on the LaTeX tab (D-046). A letter with
 * neither is one LaTeX document, as letters always were, and shows only
 * that.
 *
 * Editing here is *not* a global edit, which is the opposite of everything
 * on the resume side: each letter is its own copy and belongs to whichever
 * application holds it.
 */
export default function CoverLetterEditor({
  coverLetterId,
  applicationId,
  review,
}: CoverLetterEditorProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tab, setTab] = useState<LetterTab>('body');
  const [nameStatus, setNameStatus] = useState<SaveStatus>('idle');
  const [contentStatus, setContentStatus] = useState<SaveStatus>('idle');
  const [bodyStatus, setBodyStatus] = useState<SaveStatus>('idle');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Only the latest load may land, as in `ResumeEditor`: StrictMode runs
  // the effect twice under `next dev`, and Retry starts another. An older
  // answer arriving last would put back text the user has typed over since.
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    setState({ status: 'loading' });
    try {
      const letter = await getCoverLetter(coverLetterId);
      if (request !== latestLoad.current) return;
      // Decided once, here, rather than on every keystroke: a marker typed
      // on the LaTeX tab brings the tabs up without moving you off it.
      setTab(takesPlainBody(letter) ? 'body' : 'latex');
      setState({ status: 'ready', letter });
    } catch (error) {
      if (request !== latestLoad.current) return;
      setState({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load this cover letter.',
      });
    }
  }, [coverLetterId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Read through a ref so the body channel, made once per letter, always
  // calls the step's current callback.
  const onBodySavedRef = useRef(review?.onBodySaved);
  onBodySavedRef.current = review?.onBodySaved;

  /** Three channels, the same reason the application editor has more than
   *  one: a whole LaTeX document, or a letter's prose, is a big payload and
   *  debounces longer than a name does. The LaTeX and the body save apart so
   *  neither ever overwrites the other with what it held a second ago. */
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

  const bodySave = useMemo(
    () =>
      createAutosave<string>({
        debounceMs: 1000,
        save: async (body) => {
          await updateCoverLetter(coverLetterId, { body });
          onBodySavedRef.current?.();
        },
        onStatusChange: setBodyStatus,
      }),
    [coverLetterId],
  );

  const content = state.status === 'ready' ? state.letter.content : '';
  const body = state.status === 'ready' ? state.letter.body : null;

  const handleContentChange = useCallback(
    (next: string) => {
      setState((prev) =>
        prev.status !== 'ready' ? prev : { ...prev, letter: { ...prev.letter, content: next } },
      );
      contentSave.schedule(next);
    },
    [contentSave],
  );

  const handleBodyChange = useCallback(
    (next: string) => {
      setState((prev) =>
        prev.status !== 'ready' ? prev : { ...prev, letter: { ...prev.letter, body: next } },
      );
      bodySave.schedule(next);
    },
    [bodySave],
  );

  // The preview compiles what is on screen, not what is stored — the
  // override trick the Template tab uses, for the same reason: a 1s autosave
  // debounce must not make the preview a second behind.
  const renderPreview = useCallback(
    () => renderCoverLetter(coverLetterId, { content, body: body ?? undefined }),
    [coverLetterId, content, body],
  );
  const renderKey = JSON.stringify([content, body]);

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

  // In review the editor fills its step, under the page's own header.
  const frame = review ? 'flex min-h-0 flex-1' : 'flex h-screen';

  if (state.status === 'loading') {
    return (
      <div className={`${frame} items-center justify-center text-sm text-ink-dim`}>
        Loading cover letter…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={`${frame} items-center justify-center p-6`}>
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
  const plain = takesPlainBody(letter);
  if (review && !plain) return review.latexOnly(letter);

  const saveStatus = combineStatuses([nameStatus, contentStatus, bodyStatus]);
  const retrySaves = () => {
    nameSave.retry();
    contentSave.retry();
    bodySave.retry();
  };
  const backHref = applicationId ? `/applications/${applicationId}` : '/cover-letters';
  const backLabel = applicationId ? '← Application' : '← Cover letters';

  const bodyField = (
    <CoverLetterBodyField
      value={body ?? ''}
      onChange={handleBodyChange}
      status={review ? <SaveStatusBadge status={saveStatus} onRetry={retrySaves} /> : null}
    />
  );

  const latexField = (
    <div className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-line bg-surface p-4">
      <p className="shrink-0 text-xs text-ink-dim">
        {plain
          ? 'The layout around your text. Keep exactly one line holding only %%BODY%%; that is where the text goes.'
          : 'The whole letter, as LaTeX. Unlike a resume this text belongs to this letter alone — editing it changes nothing else.'}
      </p>
      <TemplateEditor
        value={content}
        onChange={handleContentChange}
        ariaLabel="Cover letter LaTeX"
      />
    </div>
  );

  let leftPane: ReactNode;
  if (review) {
    leftPane = bodyField;
  } else if (!plain) {
    leftPane = latexField;
  } else {
    leftPane = (
      <div className="flex h-full flex-col gap-2">
        <nav className="flex shrink-0 gap-1" role="tablist" aria-label="Letter sections">
          <TabButton active={tab === 'body'} onClick={() => setTab('body')}>
            Body
          </TabButton>
          <TabButton active={tab === 'latex'} onClick={() => setTab('latex')}>
            LaTeX
          </TabButton>
        </nav>
        <div className="min-h-0 flex-1">{tab === 'body' ? bodyField : latexField}</div>
      </div>
    );
  }

  return (
    <div className={`${frame} flex-col bg-canvas`}>
      {review ? null : (
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
            <SaveStatusBadge status={saveStatus} onRetry={retrySaves} />
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
      )}

      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div style={{ width: `${splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
          {leftPane}
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
          <PreviewPane renderKey={renderKey} render={renderPreview} />
        </div>
      </div>

      {review ? (
        // `pr-48` keeps the actions out from under the fixed "Give feedback"
        // button (FeedbackWidget), as the resume step's footer does.
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface py-3 pr-48 pl-4">
          <p className="text-xs text-ink-dim">Editing this text changes this letter only.</p>
          <div className="flex flex-wrap items-center gap-2">{review.actions(saveStatus)}</div>
        </footer>
      ) : null}
    </div>
  );
}
