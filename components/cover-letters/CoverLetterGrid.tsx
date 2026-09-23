'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, createCoverLetter, listCoverLetters } from '@/lib/api-client';
import { fuzzyFilter } from '@/lib/fuzzy';
import type { CoverLetterSummary } from '@/lib/types';
import CoverLetterCard from '@/components/cover-letters/CoverLetterCard';
import NewDocumentCard from '@/components/NewDocumentCard';
import NewDocumentDialog from '@/components/NewDocumentDialog';
import SearchBox from '@/components/SearchBox';
import { useSearchShortcut } from '@/components/useSearchShortcut';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; letters: CoverLetterSummary[] };

/** Stable identity for the not-yet-loaded case, so the memos below don't
 *  recompute on every render against a fresh `[]` literal. */
const NO_LETTERS: readonly CoverLetterSummary[] = [];

/**
 * The cover letter library — the resume grid's counterpart, and the only
 * way to reach the Default letter, which is what every new one is copied
 * from. Most rows here belong to one application and will never be opened
 * again; they are kept because with no PDF snapshot the text is the record
 * of what was sent (D-035).
 */
export default function CoverLetterGrid() {
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
        const letters = await listCoverLetters();
        if (!cancelled) setState({ status: 'ready', letters });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof ApiError ? error.message : 'Could not load cover letters.',
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

  const letters = state.status === 'ready' ? state.letters : NO_LETTERS;
  const defaultLetter = useMemo(
    () => letters.find((letter) => letter.isDefault) ?? null,
    [letters],
  );
  const otherLetters = useMemo(
    () => letters.filter((letter) => letter.id !== defaultLetter?.id),
    [letters, defaultLetter],
  );

  const visibleLetters = useMemo(() => {
    if (query.trim().length === 0) return otherLetters;
    const matches = fuzzyFilter(otherLetters, query, (letter) => letter.name);
    return matches.map((match) => otherLetters[match.index]!);
  }, [otherLetters, query]);

  async function handleCreate(name: string): Promise<void> {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCoverLetter(name);
      router.push(`/cover-letter/${created.id}`);
    } catch (error) {
      setCreateError(error instanceof ApiError ? error.message : 'Could not create cover letter.');
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Cover letters</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Each one is its own LaTeX document, copied from your Default and edited for the job.
            Unlike a resume, editing one changes nothing else.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <Link href="/" className="text-sm text-accent transition-opacity hover:opacity-80">
              ← Applications
            </Link>
            <Link
              href="/resumes"
              className="text-sm text-accent transition-opacity hover:opacity-80"
            >
              Resumes →
            </Link>
          </div>
        </div>
        <SearchBox
          ref={searchRef}
          value={query}
          onChange={setQuery}
          label="Search cover letters"
          placeholder="Search cover letters…"
        />
      </header>

      {state.status === 'loading' ? <GridSkeleton /> : null}

      {state.status === 'error' ? (
        <div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
          <p className="font-medium">Couldn&apos;t load your cover letters.</p>
          <p className="mt-1 text-danger/80">{state.message}</p>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <NewDocumentCard label="New cover letter" onClick={() => setDialogOpen(true)} />
            {defaultLetter ? <CoverLetterCard letter={defaultLetter} /> : null}
            {visibleLetters.map((letter) => (
              <CoverLetterCard key={letter.id} letter={letter} />
            ))}
          </div>

          {letters.length > 0 && query.trim().length > 0 && visibleLetters.length === 0 ? (
            <p className="mt-10 text-sm text-ink-dim">
              No cover letters match &quot;{query}&quot;.
            </p>
          ) : null}
        </>
      ) : null}

      <NewDocumentDialog
        title="New cover letter"
        description="What company is this for? Starts as a copy of your Default cover letter."
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
