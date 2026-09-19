'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppliedTable from '@/components/applications/AppliedTable';
import KanbanBoard from '@/components/applications/KanbanBoard';
import NewApplicationDialog, {
  type NewApplicationInput,
} from '@/components/applications/NewApplicationDialog';
import SearchBox from '@/components/SearchBox';
import { useSearchShortcut } from '@/components/useSearchShortcut';
import {
  ApiError,
  createApplication,
  listApplications,
  listResumes,
  updateApplication,
} from '@/lib/api-client';
import { closedApplications } from '@/lib/applications/board';
import { fuzzyFilter } from '@/lib/fuzzy';
import type { ApplicationStatus, ApplicationSummary, ResumeSummary } from '@/lib/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; applications: ApplicationSummary[] };

type Tab = 'pipeline' | 'applied';

/** Stable identity for the not-yet-loaded case, so the memos below don't
 *  recompute on every render against a fresh `[]` literal. */
const NO_APPLICATIONS: readonly ApplicationSummary[] = [];

/**
 * The app's front door: every application, split in two.
 *
 * The **pipeline** is a column per status that still needs something from
 * you. **Applied** is everything sent and waiting, as a searchable table —
 * it is where most applications end up and stay, and mixing that pile into
 * the board would bury the handful that are actually live.
 *
 * The grouping and ordering are `lib/applications/board.ts`, which is pure
 * and tested; this fetches, searches and creates.
 */
export default function ApplicationsBoard() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [tab, setTab] = useState<Tab>('pipeline');
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

  // The resume list is only needed by the new-application dialog, which
  // starts every application from an existing resume.
  useEffect(() => {
    let cancelled = false;
    void listResumes().then(
      (loaded) => {
        if (!cancelled) setResumes(loaded);
      },
      () => {
        // A failure here costs the "start from" dropdown its options, not the
        // board; the dialog falls back to creating no resume.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

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

  const closed = useMemo(() => closedApplications(visible), [visible]);
  const closedTotal = useMemo(() => closedApplications(applications).length, [applications]);

  async function handleCreate(input: NewApplicationInput): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createApplication({
        company: input.company,
        roleTitle: input.roleTitle,
        postingUrl: input.postingUrl,
        createResumeFrom: input.startFromResumeId,
      });
      router.push(`/applications/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : 'Could not add the application.');
      setCreating(false);
    }
  }

  function handleStatusChange(id: string, status: ApplicationStatus): void {
    setState((current) =>
      current.status !== 'ready'
        ? current
        : {
            ...current,
            applications: current.applications.map((application) =>
              application.id === id ? { ...application, status } : application,
            ),
          },
    );
    void updateApplication(id, { status }).then(
      (updated) =>
        setState((current) =>
          current.status !== 'ready'
            ? current
            : {
                ...current,
                applications: current.applications.map((application) =>
                  application.id === id ? updated : application,
                ),
              },
        ),
      () => void load(showArchived),
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Applications</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Every job you have applied to, and where each one stands.
          </p>
          <Link
            href="/resumes"
            className="mt-2 inline-block text-sm text-accent transition-opacity hover:opacity-80"
          >
            Resumes →
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line">
        <nav className="flex gap-1" role="tablist" aria-label="Application views">
          <TabButton active={tab === 'pipeline'} onClick={() => setTab('pipeline')}>
            Pipeline
          </TabButton>
          <TabButton active={tab === 'applied'} onClick={() => setTab('applied')}>
            Applied ({closedTotal})
          </TabButton>
        </nav>

        <label className="flex items-center gap-2 pb-1.5 text-xs text-ink-dim">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="h-3.5 w-3.5 accent-accent"
          />
          Show archived
        </label>
      </div>

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
          {tab === 'pipeline' ? (
            <KanbanBoard applications={visible} onStatusChange={handleStatusChange} />
          ) : (
            <AppliedTable applications={closed} onStatusChange={handleStatusChange} />
          )}

          {applications.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">
              No applications yet. Add one as soon as you see a posting — it starts from a resume
              you already have, and you tailor the copy from inside it.
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
        resumes={resumes}
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-t-md border-b-2 px-3 py-1.5 text-sm transition-colors ${
        active ? 'border-accent text-ink' : 'border-transparent text-ink-dim hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
      ))}
    </div>
  );
}
