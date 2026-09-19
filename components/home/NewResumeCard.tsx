'use client';

interface NewResumeCardProps {
  onClick: () => void;
}

/** Blank, always-pinned top-left card. Opens the new-resume dialog. */
export default function NewResumeCard({ onClick }: NewResumeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-line)] bg-transparent text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus:border-[var(--color-accent)] focus:text-[var(--color-accent)] focus:outline-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-6 w-6 text-current transition-transform group-hover:scale-110"
      >
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-medium">New resume</span>
    </button>
  );
}
