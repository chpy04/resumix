'use client';

import { useRef, useState } from 'react';
import { MAX_ATTACHMENT_BYTES } from '@/lib/applications/attachments';
import {
  ApiError,
  downloadApplicationFile,
  updateApplicationFile,
  uploadApplicationFile,
} from '@/lib/api-client';
import type { ApplicationFile } from '@/lib/types';

interface AttachmentsPanelProps {
  applicationId: string;
  files: ApplicationFile[];
  onFilesChange: (files: ApplicationFile[]) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Anything else that belongs to this application: a take-home, the offer
 * letter, a screenshot of the posting. Untyped on purpose — no categories to
 * pick from, because every application wants something slightly different
 * (D-032). A cover letter authored in this app is not one of these: it is a
 * `cover_letter` row with its own panel (D-035).
 *
 * Archiving hides a file rather than deleting it, like every other removal in
 * the app (D-011).
 */
export default function AttachmentsPanel({
  applicationId,
  files,
  onFilesChange,
}: AttachmentsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = showArchived ? files : files.filter((file) => !file.isArchived);
  const archivedCount = files.filter((file) => file.isArchived).length;

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setError(null);
    try {
      const created = await uploadApplicationFile(applicationId, file);
      onFilesChange([created, ...files]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleArchive(file: ApplicationFile): Promise<void> {
    setError(null);
    try {
      const updated = await updateApplicationFile(file.id, { isArchived: !file.isArchived });
      onFilesChange(files.map((existing) => (existing.id === file.id ? updated : existing)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the file.');
    }
  }

  async function handleDownload(file: ApplicationFile): Promise<void> {
    setError(null);
    try {
      await downloadApplicationFile(file.id, file.filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed.');
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Files</h2>
        {archivedCount > 0 ? (
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Show archived ({archivedCount})
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-ink-dim">
          No files yet. Take-homes, the offer letter, a screenshot of the posting — anything. (A
          cover letter you write here is not a file; it has its own panel above.)
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-sm text-ink" title={file.filename}>
                {file.filename}
                <span className="ml-2 text-xs text-ink-dim">{formatSize(file.byteSize)}</span>
                {file.isArchived ? (
                  <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[10px] tracking-wide text-ink-dim uppercase">
                    Archived
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleDownload(file)}
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => void handleArchive(file)}
                  title={file.isArchived ? 'Unarchive' : 'Archive — there is no delete'}
                  className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim transition-colors hover:border-accent hover:text-accent"
                >
                  {file.isArchived ? 'Unarchive' : 'Archive'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          aria-label="Attach a file"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
          className="block w-full max-w-xs text-xs text-ink-dim file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-2.5 file:py-1.5 file:text-xs file:text-ink hover:file:border-accent"
        />
        <span className="text-xs text-ink-dim">
          {uploading ? 'Uploading…' : `Up to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each`}
        </span>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </section>
  );
}
