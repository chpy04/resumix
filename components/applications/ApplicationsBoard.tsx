'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ApplicationCard from '@/components/applications/ApplicationCard';
import NewApplicationDialog, {
  type NewApplicationInput,
} from '@/components/applications/NewApplicationDialog';
import SearchBox from '@/components/SearchBox';
import { useSearchShortcut } from '@/components/useSearchShortcut';
import { ApiError, createApplication, listApplications } from '@/lib/api-client';
import { groupByStatus } from '@/lib/applications/board';
import { statusLabel } from '@/lib/applications/status';
import { fuzzyFilter } from '@/lib/fuzzy';
import type { ApplicationSummary } from '@/lib/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; applications: ApplicationSummary[] };

/** Stable identity for the not-yet-loaded case, so the memos below don't
 *  recompute on every render against a fresh `[]` literal. */
const NO_APPLICATIONS: readonly ApplicationSummary[] = [];

/**
 * Every application, in a column per status: what is still alive, what has
 * gone quiet, and — through each card's PDF button — what was actually sent.
 *
 * The grouping and ordering are `lib/applications/board.ts`, which is pure
 * and tested; this fetches, searches and creates.
 */
export default function ApplicationsBoard() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useSearchShortcut(searchRef);

  const load = useCallback(async (includeArchived: boolean): Promise<void> => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', applications: await listApplications(includeArchived) });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof ApiError ? error.message : 'Could not load applications.',
      });
    }
  }, []);

  useEffect(() => {
    void load(showArchived);
  }, [load, showArchived]);

  const applications = state.status === 'ready' ? state.applications : NO_APPLICATIONS;

  const visible = useMemo(() => {
    if (query.trim().length === 0) return [...applications];
    const matches = fuzzyFilter(
      applications,
      query,
      (application) => `${application.company} ${application.roleTitle}`,
    );
    return matches.map((match) => applications[match.index]!);
  }, [applications, query]);

  const columns = useMemo(() => groupByStatus(visible), [visible]);

  async function handleCreate(input: NewApplicationInput): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createApplication(input);
      router.push(`/applications/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : 'Could not add the application.');
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Applications</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Every job you have applied to, and where each one stands.
          </p>
          <Link
            href="/"
            className="mt-2 inline-block text-sm text-accent transition-opacity hover:opacity-80"
          >
            ← Resumes
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            ref={searchRef}
            value={query}
            onChange={setQuery}
            label="Search applications"
            placeholder="Search applications…"
          />
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-canvas transition-opacity hover:opacity-90"
          >
            New application
          </button>
        </div>
      </header>

      <label className="mb-4 flex w-fit items-center gap-2 text-xs text-ink-dim">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => setShowArchived(event.target.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        Show archived
      </label>

      {state.status === 'loading' ? <BoardSkeleton /> : null}

      {state.status === 'error' ? (
        <div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load your applications.</p>
          <p className="mt-1 text-danger/80">{state.message}</p>
          <button
            type="button"
            onClick={() => void load(showArchived)}
            className="mt-4 rounded-md border border-danger-line-strong px-3 py-1.5 text-sm text-danger-ink-strong transition-colors hover:bg-danger-line/30"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {columns.map((column) => (
              <section key={column.status} className="flex flex-col gap-2">
                <h2 className="flex items-center justify-between border-b border-line pb-1.5 text-xs font-semibold tracking-wide text-ink-dim uppercase">
                  {statusLabel(column.status)}
                  <span className="text-ink-dim/70">{column.applications.length}</span>
                </h2>
                {column.applications.map((application) => (
                  <ApplicationCard key={application.id} application={application} />
                ))}
              </section>
            ))}
          </div>

          {applications.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">
              No applications yet. Add one as soon as you see a posting — you can link a resume and
              write the cover letter from inside it.
            </p>
          ) : null}

          {applications.length > 0 && query.trim().length > 0 && visible.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">No applications match &quot;{query}&quot;.</p>
          ) : null}
        </>
      ) : null}

      <NewApplicationDialog
        open={dialogOpen}
        submitting={creating}
        error={createError}
        onSubmit={(input) => void handleCreate(input)}
        onClose={() => {
          if (creating) return;
          setDialogOpen(false);
          setCreateError(null);
        }}
      />
    </main>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
      ))}
    </div>
  );
}
