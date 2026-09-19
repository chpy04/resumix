'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, downloadApplicationPdf } from '@/lib/api-client';
import { APPLICATION_STATUSES, statusLabel } from '@/lib/applications/status';
import type { ApplicationStatus, ApplicationSummary } from '@/lib/types';

interface AppliedTableProps {
  applications: ApplicationSummary[];
  /** Moving a row out of Applied — a reply arrived — takes it off this table
   *  and back onto the board, so the parent owns the update. */
  onStatusChange: (id: string, status: ApplicationStatus) => void;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter.format(date);
}

/**
 * Everything that has left the board — sent and waiting, or rejected — as a
 * table rather than cards.
 *
 * Most applications end their life here and are never touched again, which
 * makes density and search the things worth optimising for, not the
 * drag-and-drop affordances the pipeline needs. The status column is the way
 * back: a reply turns a row into a card again.
 */
export default function AppliedTable({ applications, onStatusChange }: AppliedTableProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(id: string): Promise<void> {
    setDownloadingId(id);
    setError(null);
    try {
      await downloadApplicationPdf(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  if (applications.length === 0) {
    return (
      <p className="text-sm text-ink-dim">
        Nothing here yet. Applications land in this table once they are applied or rejected — drag a
        card onto one of those zones, or use the button on the application itself.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface text-left text-xs tracking-wide text-ink-dim uppercase">
            <th className="px-3 py-2 font-semibold">Company</th>
            <th className="px-3 py-2 font-semibold">Role</th>
            <th className="px-3 py-2 font-semibold">Applied</th>
            <th className="px-3 py-2 font-semibold">Resume</th>
            <th className="px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((application) => (
            <tr
              key={application.id}
              data-testid={`applied-row-${application.id}`}
              className="border-b border-line/60 last:border-b-0 hover:bg-surface"
            >
              <td className="px-3 py-2">
                <Link
                  href={`/applications/${application.id}`}
                  className="font-medium text-ink transition-colors hover:text-accent"
                >
                  {application.company}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">{application.roleTitle || '—'}</td>
              <td className="px-3 py-2 text-ink-dim">{formatDate(application.appliedAt)}</td>
              <td className="px-3 py-2">
                {application.sentPdf ? (
                  <button
                    type="button"
                    data-testid="application-download-button"
                    onClick={() => void handleDownload(application.id)}
                    disabled={downloadingId === application.id}
                    title={`Download ${application.sentPdf.filename} — what this application was sent with`}
                    className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                  >
                    {downloadingId === application.id ? 'Downloading…' : 'PDF'}
                  </button>
                ) : (
                  <span className="text-xs text-ink-dim">none</span>
                )}
              </td>
              <td className="px-3 py-2">
                <select
                  value={application.status}
                  aria-label={`Status for ${application.company}`}
                  onChange={(event) =>
                    onStatusChange(application.id, event.target.value as ApplicationStatus)
                  }
                  className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                >
                  {APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error ? <p className="border-t border-line px-3 py-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}
