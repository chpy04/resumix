'use client';

interface NewDocumentCardProps {
  /** What this creates — "New resume", "New cover letter". */
  label: string;
  onClick: () => void;
}

/** Blank, always-pinned top-left cell of a document grid. Opens that grid's
 *  `NewDocumentDialog`. */
export default function NewDocumentCard({ label, onClick }: NewDocumentCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-transparent text-ink-dim transition-colors hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-6 w-6 text-current transition-transform group-hover:scale-110"
      >
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}
