'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { createAutosave, type AutosaveController } from '@/lib/editor/autosave';
import { base64PdfToObjectUrl } from '@/lib/preview/pdf-blob';
import type { RenderResult } from '@/lib/types';

// react-pdf touches canvas/DOM APIs that don't exist during Next's server
// render, so the viewer is loaded client-only (the documented react-pdf +
// Next.js trap). See `PdfViewer.tsx` for the matching worker-source setup.
const PdfViewer = dynamic(() => import('./PdfViewer'), {
  ssr: false,
  loading: () => <div className="p-4 text-xs text-ink-dim">Loading viewer…</div>,
});

interface PreviewPaneProps {
  /**
   * A serialization of everything the preview depends on. Changing it is
   * what schedules a re-render; its contents are never inspected. The pane
   * deliberately does not know *what* changed — a resume watches its
   * selections, library and template draft, a cover letter watches one
   * string, and neither shape belongs in here.
   */
  renderKey: string;
  /** Produces the PDF for whatever is on screen right now. Always a
   *  preview-only endpoint (`POST .../render`), never one that persists.
   *  Read through a ref, so the debounced call always uses the latest
   *  closure rather than the one that was current when it was scheduled. */
  render: () => Promise<RenderResult>;
}

type RenderPayload = { renderKey: string };

interface GoodRender {
  fileUrl: string;
  pages: number | null;
}

/**
 * Live PDF preview, shared by the resume editor (both tabs) and the cover
 * letter editor. Calls the caller's `render` — always a `POST .../render`,
 * never a `/pdf` that persists — on a 600ms debounce whenever `renderKey`
 * changes, and always converges on the *last requested* state rather than
 * whichever response lands last (see `createAutosave`'s coalescing).
 *
 * A LaTeX compile failure is a normal `200 { ok: false, errors, warnings }`
 * — not an exception — so it never blanks the pane; the last successfully
 * rendered PDF stays on screen underneath the error panel until a new
 * render succeeds.
 */
export default function PreviewPane({ renderKey, render }: PreviewPaneProps) {
  const [good, setGood] = useState<GoodRender | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<
    'idle' | 'rendering' | 'ok' | 'compile-error' | 'network-error'
  >('idle');
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(600);

  const goodUrlRef = useRef<string | null>(null);
  const renderRef = useRef(render);
  renderRef.current = render;

  // ---------------------------------------------------------------------
  // Debounced, coalescing render queue. `createAutosave` already guarantees
  // exactly one in-flight `save()` at a time and, if `schedule()` is called
  // again mid-flight, resends with the latest payload the instant the
  // in-flight call finishes — precisely "never two in flight, always end up
  // showing the latest state" (see lib/editor/autosave.ts's coalescing).
  // ---------------------------------------------------------------------
  const controllerRef = useRef<AutosaveController<RenderPayload> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAutosave<RenderPayload>({
      debounceMs: 600,
      save: async () => {
        setPhase('rendering');
        try {
          const result = await renderRef.current();
          setWarnings(result.warnings);
          if (result.ok && result.pdfBase64) {
            const url = base64PdfToObjectUrl(result.pdfBase64);
            if (goodUrlRef.current) URL.revokeObjectURL(goodUrlRef.current);
            goodUrlRef.current = url;
            setGood({ fileUrl: url, pages: result.pages });
            setErrors([]);
            setPhase('ok');
          } else {
            // Keep whatever `good` already holds — never blank the pane on
            // a transient compile failure while typing.
            setErrors(
              result.errors.length > 0 ? result.errors : ['The document failed to compile.'],
            );
            setPhase('compile-error');
          }
        } catch (error) {
          setNetworkMessage(
            error instanceof ApiError ? error.message : 'Could not reach the preview service.',
          );
          setPhase('network-error');
        }
      },
    });
  }

  useEffect(
    () => () => {
      if (goodUrlRef.current) URL.revokeObjectURL(goodUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    controllerRef.current?.schedule({ renderKey });
  }, [renderKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPageWidth(Math.max(240, Math.floor(width - 24)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const multiPage = (good?.pages ?? 0) > 1;

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden rounded-lg border border-line bg-surface p-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {phase === 'rendering' ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                className="h-3 w-3 animate-spin"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="42"
                  strokeDashoffset="14"
                />
              </svg>
              Rendering…
            </span>
          ) : null}
        </div>
        {good?.pages != null ? (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              multiPage
                ? 'border border-warning-line-strong/60 bg-warning-surface/40 text-warning-ink'
                : 'border border-line text-ink-dim'
            }`}
            title={multiPage ? 'This document is spilling past one page' : 'Page count'}
          >
            {multiPage ? '⚠ ' : ''}
            {good.pages} {good.pages === 1 ? 'page' : 'pages'}
          </span>
        ) : null}
      </div>

      {networkMessage ? (
        <div className="shrink-0 rounded-md border border-danger-line/50 bg-danger-surface/30 p-2 text-xs text-danger-ink">
          {networkMessage}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="max-h-40 shrink-0 overflow-auto rounded-md border border-danger-line/50 bg-danger-surface/30 p-2 text-xs text-danger-ink">
          <p className="mb-1 font-medium">
            This didn&apos;t compile — showing the last good preview.
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((message, index) => (
              <li key={index} className="break-words">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="max-h-24 shrink-0 overflow-auto rounded-md border border-warning-line/50 bg-warning-surface/20 p-2 text-xs text-warning-ink">
          <ul className="list-disc space-y-0.5 pl-4">
            {warnings.map((message, index) => (
              <li key={index} className="break-words">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto rounded-md bg-canvas">
        {good ? (
          <PdfViewer fileUrl={good.fileUrl} width={pageWidth} />
        ) : phase === 'rendering' ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-dim">
            Rendering your first preview…
          </div>
        ) : phase === 'compile-error' || phase === 'network-error' ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-ink-dim">
            No PDF yet — fix the error above to see a preview.
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-dim">
            Preview will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
