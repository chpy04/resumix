'use client';

import type { ReactNode } from 'react';

interface CoverLetterBodyFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Shown beside the label: the review step has no header to put the save
   *  badge in. */
  status?: ReactNode;
}

/**
 * A cover letter's prose, typed as plain text (D-046). A proportional font,
 * because this is a letter and not code, and nothing to escape by hand:
 * Resumix escapes it and puts it at the letter's `%%BODY%%` line. Shared by
 * the letter editor's Body tab and the review page's letter step.
 */
export default function CoverLetterBodyField({
  value,
  onChange,
  status,
}: CoverLetterBodyFieldProps) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden rounded-lg border border-line bg-surface p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Letter text</h2>
        {status}
      </div>
      <p className="shrink-0 text-xs text-ink-dim">
        Plain text. Resumix lays it out in your Default letter&apos;s design. A blank line starts a
        paragraph.
      </p>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Cover letter text"
        placeholder={'Dear Hiring Team,\n\n…\n\nBest,\nChris'}
        className="min-h-0 w-full flex-1 resize-none rounded-md border border-line bg-surface-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-accent"
      />
    </div>
  );
}
