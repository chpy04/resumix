'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, createResume, listResumes } from '@/lib/api-client';
import { fuzzyFilter } from '@/lib/fuzzy';
import type { ResumeSummary } from '@/lib/types';
import NewResumeCard from '@/components/home/NewResumeCard';
import NewResumeDialog from '@/components/home/NewResumeDialog';
import ResumeCard from '@/components/home/ResumeCard';
import SearchBox from '@/components/SearchBox';
import { useSearchShortcut } from '@/components/useSearchShortcut';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; resumes: ResumeSummary[] };

/** Stable identity for the not-yet-loaded case, so the memos below don't
 *  recompute on every render against a fresh `[]` literal. */
const NO_RESUMES: readonly ResumeSummary[] = [];

/** The home page's resume grid: fetches, searches, creates, and downloads. */
export default function ResumeGrid() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const resumes = await listResumes();
        if (!cancelled) setState({ status: 'ready', resumes });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load resumes.',
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useSearchShortcut(searchRef);

  const resumes = state.status === 'ready' ? state.resumes : NO_RESUMES;
  const defaultResume = useMemo(
    () => resumes.find((resume) => resume.isDefault) ?? null,
    [resumes],
  );
  const otherResumes = useMemo(
    () => resumes.filter((resume) => resume.id !== defaultResume?.id),
    [resumes, defaultResume],
  );

  const visibleResumes = useMemo(() => {
    if (query.trim().length === 0) return otherResumes;
    const matches = fuzzyFilter(otherResumes, query, (resume) => resume.name);
    return matches.map((match) => otherResumes[match.index]!);
  }, [otherResumes, query]);

  async function handleCreate(companyName: string): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createResume(companyName);
      router.push(`/resume/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : 'Could not create resume.');
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Resumes</h1>
          <p className="mt-1 text-sm text-ink-dim">
            The library behind your applications. Editing anything here changes every resume that
            selected it.
          </p>
          <Link
            href="/"
            className="mt-2 inline-block text-sm text-accent transition-opacity hover:opacity-80"
          >
            ← Applications
          </Link>
        </div>
        <SearchBox ref={searchRef} value={query} onChange={setQuery} />
      </header>

      {state.status === 'loading' ? <GridSkeleton /> : null}

      {state.status === 'error' ? (
        <div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load your resumes.</p>
          <p className="mt-1 text-danger/80">{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              void listResumes()
                .then((loaded) => setState({ status: 'ready', resumes: loaded }))
                .catch((error) =>
                  setState({
                    status: 'error',
                    message: error instanceof ApiError ? error.message : 'Could not load resumes.',
                  }),
                );
            }}
            className="mt-4 rounded-md border border-danger-line-strong px-3 py-1.5 text-sm text-danger-ink-strong transition-colors hover:bg-danger-line/30"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <NewResumeCard onClick={() => setDialogOpen(true)} />
            {defaultResume ? <ResumeCard resume={defaultResume} isDefault /> : null}
            {visibleResumes.map((resume) => (
              <ResumeCard key={resume.id} resume={resume} />
            ))}
          </div>

          {resumes.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">
              No resumes yet. Click the new resume card to create your first one.
            </p>
          ) : null}

          {resumes.length > 0 && query.trim().length > 0 && visibleResumes.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">No resumes match &quot;{query}&quot;.</p>
          ) : null}
        </>
      ) : null}

      <NewResumeDialog
        open={dialogOpen}
        submitting={creating}
        error={createError}
        onSubmit={(name) => void handleCreate(name)}
        onClose={() => {
          if (creating) return;
          setDialogOpen(false);
          setCreateError(null);
        }}
      />
    </main>
  );
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      aria-hidden="true"
    >
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="h-36 animate-pulse rounded-lg border border-line bg-surface" />
      ))}
    </div>
  );
}
