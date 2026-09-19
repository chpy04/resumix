'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ApplicationFields, {
  type ApplicationDraft,
} from '@/components/applications/ApplicationFields';
import AttachmentsPanel from '@/components/applications/AttachmentsPanel';
import SentResumePanel from '@/components/applications/SentResumePanel';
import StatusBadge from '@/components/applications/StatusBadge';
import SaveStatusBadge from '@/components/editor/SaveStatusBadge';
import {
  ApiError,
  downloadApplicationPdf,
  getApplication,
  listResumes,
  markApplicationApplied,
  updateApplication,
} from '@/lib/api-client';
import { combineStatuses, createAutosave, type SaveStatus } from '@/lib/editor/autosave';
import type {
  ApplicationDetail,
  ApplicationFile,
  ApplicationStatus,
  ResumeSummary,
} from '@/lib/types';

interface ApplicationEditorProps {
  applicationId: string;
}

function toDraft(application: ApplicationDetail): ApplicationDraft {
  return {
    company: application.company,
    roleTitle: application.roleTitle,
    postingUrl: application.postingUrl,
    notes: application.notes,
  };
}

/**
 * The detail page: fields, notes, files, and the "mark as applied" action.
 *
 * Two autosave channels, aggregated into one badge the way the resume editor
 * does it — text fields debounce at 500ms, while the status picker, the
 * resume link and archiving send immediately. Both PATCH the same row but
 * touch disjoint fields, so they cannot overwrite each other. There is no
 * Save button anywhere in this app.
 */
export default function ApplicationEditor({ applicationId }: ApplicationEditorProps) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [draft, setDraft] = useState<ApplicationDraft | null>(null);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [fieldStatus, setFieldStatus] = useState<SaveStatus>('idle');
  const [metaStatus, setMetaStatus] = useState<SaveStatus>('idle');

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const [application, resumeList] = await Promise.all([
          getApplication(applicationId),
          listResumes(),
        ]);
        if (cancelled) return;
        setDetail(application);
        setDraft(toDraft(application));
        setResumes(resumeList);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof ApiError ? error.message : 'Could not load this application.',
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  /** Text fields. The whole draft is sent every time, never one field: the
   *  autosave queue coalesces by replacement, so a partial payload could
   *  drop an edit made while an earlier save was in flight. */
  const fieldsSave = useMemo(
    () =>
      createAutosave<ApplicationDraft>({
        debounceMs: 500,
        save: async (value) => {
          setDetail(await updateApplication(applicationId, value));
        },
        onStatusChange: setFieldStatus,
      }),
    [applicationId],
  );

  /** Status, resume link, archive — nothing to debounce. */
  const metaSave = useMemo(
    () =>
      createAutosave<{
        status?: ApplicationStatus;
        resumeId?: string | null;
        isArchived?: boolean;
      }>({
        debounceMs: 0,
        save: async (value) => {
          setDetail(await updateApplication(applicationId, value));
        },
        onStatusChange: setMetaStatus,
      }),
    [applicationId],
  );

  const handleDraftChange = useCallback(
    (next: ApplicationDraft) => {
      setDraft(next);
      fieldsSave.schedule(next);
    },
    [fieldsSave],
  );

  const handleFilesChange = useCallback((files: ApplicationFile[]) => {
    setDetail((current) => (current ? { ...current, files } : current));
  }, []);

  async function handleMarkApplied(): Promise<void> {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await markApplicationApplied(applicationId);
      if (result.ok) {
        setDetail(result.application);
      } else {
        // A LaTeX failure is a normal answer here, and nothing was stored.
        setApplyError(
          result.errors[0] ?? 'The linked resume did not compile, so nothing was saved.',
        );
      }
    } catch (error) {
      setApplyError(error instanceof ApiError ? error.message : 'Could not mark this applied.');
    } finally {
      setApplying(false);
    }
  }

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setApplyError(null);
    try {
      await downloadApplicationPdf(applicationId);
    } catch (error) {
      setApplyError(error instanceof ApiError ? error.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load this application.</p>
          <p className="mt-1 text-danger/80">{loadError}</p>
          <Link href="/applications" className="mt-4 inline-block text-sm text-accent">
            ← All applications
          </Link>
        </div>
      </main>
    );
  }

  if (!detail || !draft) return null;

  const saveStatus = combineStatuses([fieldStatus, metaStatus]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/applications"
            className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            ← Applications
          </Link>
          <h1 className="min-w-0 truncate text-xl font-semibold text-ink">
            {draft.company}
            {draft.roleTitle ? <span className="text-ink-dim"> · {draft.roleTitle}</span> : null}
          </h1>
          <StatusBadge status={detail.status} />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <SaveStatusBadge
            status={saveStatus}
            onRetry={() => {
              fieldsSave.retry();
              metaSave.retry();
            }}
          />
          <button
            type="button"
            onClick={() => metaSave.schedule({ isArchived: !detail.isArchived })}
            title={
              detail.isArchived
                ? 'Put this back on the board'
                : 'Hide this from the board — there is no delete'
            }
            className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-dim transition-colors hover:border-accent hover:text-accent"
          >
            {detail.isArchived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ApplicationFields
          draft={draft}
          onDraftChange={handleDraftChange}
          status={detail.status}
          onStatusChange={(status) => metaSave.schedule({ status })}
          resumeId={detail.resumeId}
          resumes={resumes}
          onResumeChange={(resumeId) => metaSave.schedule({ resumeId })}
        />

        <div className="flex flex-col gap-6">
          <SentResumePanel
            application={detail}
            onMarkApplied={() => void handleMarkApplied()}
            onDownload={() => void handleDownload()}
            applying={applying}
            downloading={downloading}
            error={applyError}
          />
          <AttachmentsPanel
            applicationId={applicationId}
            files={detail.files}
            onFilesChange={handleFilesChange}
          />
        </div>
      </div>
    </main>
  );
}
