'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, downloadCoverLetterPdf } from '@/lib/api-client';
import type { ApplicationDetail, CoverLetterSummary } from '@/lib/types';

interface CoverLetterPanelProps {
  application: ApplicationDetail;
  /** Every letter the caller owns, for the "link an existing one" picker. */
  coverLetters: CoverLetterSummary[];
  /** Copies the Default letter under this company's name and links it. */
  onAdd: () => void;
  onLink: (coverLetterId: string | null) => void;
  adding: boolean;
  error: string | null;
}

/**
 * The cover letter side of an application, sitting beside `SentResumePanel`.
 *
 * Shorter than that panel by design. A resume needs two rows — the live one
 * and the frozen PDF that went out — because the content under a resume is
 * shared and keeps moving. A cover letter is a private copy, so there is one
 * row: the letter, which *is* what was sent (D-035).
 */
export default function CoverLetterPanel({
  application,
  coverLetters,
  onAdd,
  onLink,
  adding,
  error,
}: CoverLetterPanelProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { coverLetterId } = application;
  const linked = coverLetters.find((letter) => letter.id === coverLetterId) ?? null;

  async function handleDownload(): Promise<void> {
    if (!coverLetterId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadCoverLetterPdf(coverLetterId);
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Cover letter</h2>

      {coverLetterId ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm text-ink" title={linked?.name}>
              {linked?.name ?? 'Linked cover letter'}
            </span>
            <Link
              href={`/cover-letter/${coverLetterId}?application=${application.id}`}
              data-testid="application-edit-cover-letter"
              className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
            >
              Write it →
            </Link>
            <button
              type="button"
              data-testid="application-cover-letter-download"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          </div>
          <p className="text-xs text-ink-dim">
            This letter belongs to this application. Editing it changes what gets sent and nothing
            else — there is no snapshot standing between the two.
          </p>
          <button
            type="button"
            onClick={() => onLink(null)}
            title="Unlinks it here; the letter stays in your library"
            className="self-start text-xs text-ink-dim underline transition-colors hover:text-accent"
          >
            Unlink
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-dim">
            No cover letter yet. Adding one copies your Default and names it after the company.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="application-add-cover-letter"
              onClick={onAdd}
              disabled={adding}
              // Bordered, not accent: "Mark as applied" is the one primary
              // action in this column, and two filled buttons side by side
              // read as a choice between equals.
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add a cover letter'}
            </button>
            {coverLetters.length > 0 ? (
              <label className="flex items-center gap-2 text-xs text-ink-dim">
                or link
                <select
                  aria-label="Link an existing cover letter"
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onLink(event.target.value);
                  }}
                  className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                >
                  <option value="">an existing one…</option>
                  {coverLetters.map((letter) => (
                    <option key={letter.id} value={letter.id}>
                      {letter.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </>
      )}

      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {downloadError ? <p className="text-xs text-danger">{downloadError}</p> : null}
    </section>
  );
}
