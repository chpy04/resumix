'use client';

import { useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// react-pdf ships a default `workerSrc` that points at a bare `pdf.worker.mjs`
// path, which doesn't resolve under Next.js and (worse) a CDN fallback would
// silently version-skew against the `pdfjs-dist` copy react-pdf actually
// bundles. We instead serve the exact matching worker build as a static
// asset — see `public/pdf.worker.min.mjs`, copied from
// `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` at the same resolved
// version react-pdf depends on.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

interface PdfViewerProps {
  fileUrl: string;
  /** Width in px the page should render at; container drives this so the
   *  PDF scales with the split-pane divider instead of overflowing it. */
  width: number;
}

/**
 * Thin wrapper around react-pdf's `<Document>`/`<Page>`. This module is only
 * ever loaded client-side — see `PreviewPane.tsx`, which imports it via
 * `next/dynamic({ ssr: false })`, because react-pdf reaches for DOM/canvas
 * APIs that don't exist during Next's server render.
 */
export default function PdfViewer({ fileUrl, width }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // A new render produces a new blob URL; forget the old page count until
  // the new document reports its own, so we never show a stale count.
  useEffect(() => {
    setNumPages(null);
    setPageError(null);
  }, [fileUrl]);

  return (
    <Document
      file={fileUrl}
      onLoadSuccess={({ numPages: n }) => setNumPages(n)}
      onLoadError={(error) => setPageError(error.message)}
      loading={<div className="p-4 text-xs text-ink-dim">Loading PDF…</div>}
      error={
        <div className="p-4 text-xs text-danger">
          Could not display this PDF{pageError ? `: ${pageError}` : '.'}
        </div>
      }
      className="flex flex-col items-center gap-3"
    >
      {numPages !== null &&
        Array.from({ length: numPages }, (_, index) => (
          <Page
            key={index}
            pageNumber={index + 1}
            width={width}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            className="shadow-md"
          />
        ))}
    </Document>
  );
}
