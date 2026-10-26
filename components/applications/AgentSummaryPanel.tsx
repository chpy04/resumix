'use client';

interface AgentSummaryPanelProps {
  agentSummary: string | null;
  jobDescription: string | null;
  fitScore: number | null;
}

function present(text: string | null): text is string {
  return text !== null && text.trim().length > 0;
}

/**
 * What the agent brought with the application: its evaluation, and the
 * posting it evaluated. Read-only — both arrive with the application from the
 * agent, and editing them here would only make them disagree with what it
 * actually read (D-041).
 *
 * Renders nothing for an application logged by hand, which has neither.
 *
 * The summary is plain text with its line breaks kept, not rendered markdown:
 * a markdown renderer would be a new dependency for one panel.
 */
export default function AgentSummaryPanel({
  agentSummary,
  jobDescription,
  fitScore,
}: AgentSummaryPanelProps) {
  if (!present(agentSummary) && !present(jobDescription)) return null;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      {present(agentSummary) ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">
            Agent summary
            {fitScore !== null ? (
              <span className="font-normal text-ink-dim"> · fit {fitScore.toFixed(1)}</span>
            ) : null}
          </h2>
          <p
            data-testid="application-agent-summary"
            className="text-sm whitespace-pre-wrap text-ink-dim"
          >
            {agentSummary}
          </p>
        </div>
      ) : null}

      {present(jobDescription) ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Job description</h2>
          <div
            data-testid="application-job-description"
            className="max-h-96 overflow-y-auto rounded-md border border-line bg-surface-2 p-3 text-sm whitespace-pre-wrap text-ink-dim"
          >
            {jobDescription}
          </div>
        </div>
      ) : null}
    </section>
  );
}
