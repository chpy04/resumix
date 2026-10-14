'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { normalizeSuggestionText, suggestionTextProblem } from '@/lib/applications/suggestions';
import { hasLatexMarkup } from '@/lib/editor/suggestions';
import { latexToPlainText } from '@/lib/render/plain-text';
import type { BulletSuggestion, BulletSuggestionAction } from '@/lib/types';

/** What the review step's editor hands every card (D-045). */
export interface SuggestionHandlers {
  /** What the card's field shows: Chris's draft, or the stored text. */
  textOf: (suggestion: BulletSuggestion) => string;
  onTextChange: (suggestion: BulletSuggestion, text: string) => void;
  /** Throws, for the card to show, when the server refuses. */
  onResolve: (suggestion: BulletSuggestion, action: BulletSuggestionAction) => Promise<void>;
  /** Why no suggestion can be resolved right now (an edit still saving, or
   *  the application out of review), or null. */
  disabledReason: string | null;
}

interface SuggestionCardProps {
  suggestion: BulletSuggestion;
  /** An edit's bullet as stored, raw LaTeX: the "was" line, and whether
   *  applying would drop its formatting. Null for an addition. */
  current: string | null;
  handlers: SuggestionHandlers;
}

/**
 * One of the agent's suggestions, inline in the bullet list. An edit is the
 * lower half of its bullet's row, which carries the yellow outline; an
 * addition is a green card of its own, in the slot it would print in. The
 * proposed text is plain and editable until it is resolved; the preview
 * already shows it.
 */
export default function SuggestionCard({ suggestion, current, handlers }: SuggestionCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = handlers.textOf(suggestion);
  const problem = suggestionTextProblem(normalizeSuggestionText(text));
  const blocked = handlers.disabledReason ?? (problem ? `The text ${problem}.` : null);
  const isEdit = suggestion.kind === 'edit';

  async function resolve(action: BulletSuggestionAction): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await handlers.onResolve(suggestion, action);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resolve this suggestion.');
    } finally {
      setBusy(false);
    }
  }

  const button =
    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const disabled = busy || blocked !== null;

  const body = (
    <>
      <p
        className={`text-[10px] font-semibold tracking-wide uppercase ${
          isEdit ? 'text-warning-ink' : 'text-success-ink'
        }`}
      >
        {isEdit ? 'Suggested edit' : '+ Suggested new bullet'}
      </p>
      <label className="flex items-center gap-2 text-xs text-ink-dim">
        {isEdit ? <span className="w-8 shrink-0">now</span> : null}
        <input
          value={text}
          onChange={(event) => handlers.onTextChange(suggestion, event.target.value)}
          aria-label="Suggested text"
          spellCheck
          className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-xs text-ink outline-none focus:border-accent"
        />
      </label>
      {problem ? <p className="text-xs text-danger">The text {problem}.</p> : null}
      {isEdit && current !== null ? (
        <p className="text-xs text-ink-dim">
          <span className="inline-block w-10">was</span> {latexToPlainText(current)}
        </p>
      ) : null}
      <p className="text-xs text-ink-dim">
        {isEdit ? <span className="inline-block w-10">why</span> : 'why:'} {suggestion.rationale}
      </p>
      {isEdit && current !== null && hasLatexMarkup(current) ? (
        <p className="text-xs text-warning">
          ⚠ Applying replaces this bullet&apos;s LaTeX; its formatting is not kept.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => void resolve('apply')}
          disabled={disabled}
          title={blocked ?? undefined}
          className={`${button} border-success-line bg-success-surface/30 text-success-ink hover:bg-success-surface/60`}
        >
          {isEdit ? 'Apply to bullet' : 'Add bullet'}
        </button>
        {isEdit ? (
          <button
            type="button"
            onClick={() => void resolve('copy')}
            disabled={disabled}
            title={blocked ?? 'Adds it as a new bullet and swaps it in on this resume only'}
            className={`${button} border-accent/50 text-accent hover:bg-accent/10`}
          >
            Save as new
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void resolve('reject')}
          disabled={busy || handlers.disabledReason !== null}
          title={handlers.disabledReason ?? undefined}
          className={`${button} border-line text-ink-dim hover:border-accent hover:text-accent`}
        >
          Reject
        </button>
        {isEdit ? (
          <span className="text-[11px] text-ink-dim">Apply changes every resume using it.</span>
        ) : null}
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
    </>
  );

  if (isEdit) {
    return (
      <div
        data-testid={`suggestion-card-${suggestion.id}`}
        className="mt-1.5 flex flex-col gap-1 border-t border-warning-line/60 pt-1.5 pl-7"
      >
        {body}
      </div>
    );
  }
  return (
    <div
      data-testid={`suggestion-card-${suggestion.id}`}
      className="flex flex-col gap-1 rounded border border-success-line bg-success-surface/20 px-2 py-1.5"
    >
      {body}
    </div>
  );
}
