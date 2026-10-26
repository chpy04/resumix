'use client';

/** What the checkbox shows for one question. */
export interface RememberState {
  /** On screen: ticked, saved or not. */
  checked: boolean;
  /** `rememberProblem` for what is on screen: why it cannot be ticked. */
  problem: string | null;
  /** The answer is still saving. The server remembers what it holds, so
   *  the box waits for it. */
  busy: boolean;
}

interface RememberAnswerCheckboxProps extends RememberState {
  onChange: (remember: boolean) => void;
  /** One word, for the profile group's rows; the hint is a tooltip. */
  compact?: boolean;
}

const HINT = 'Saved for future applications. Editing this answer changes the saved one too.';

/**
 * "Remember this answer" (D-048). Ticking saves the answer for the agent to
 * reuse, already approved, on later forms; unticking retires it, which is
 * the only way to, since there is no page for saved answers. Unticking is
 * always allowed, so a wrong answer can be retired even once it is blank.
 *
 * Why it cannot be ticked is shown beside it. Waiting for a save is a
 * tooltip, as on Approve, since it comes and goes with every keystroke.
 */
export default function RememberAnswerCheckbox({
  checked,
  problem,
  busy,
  onChange,
  compact = false,
}: RememberAnswerCheckboxProps) {
  const blocked = checked ? null : problem;
  const title = busy ? 'Waiting for your changes to save' : compact ? (blocked ?? HINT) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <label className="flex items-center gap-1.5 text-xs text-ink-dim" title={title}>
        <input
          type="checkbox"
          aria-label="remember this answer"
          checked={checked}
          disabled={busy || blocked !== null}
          onChange={(event) => onChange(event.target.checked)}
          className="h-3.5 w-3.5 accent-accent disabled:cursor-not-allowed"
        />
        {compact ? 'remember' : 'remember this answer'}
        {!compact && blocked ? <span className="text-ink-dim/80">· {blocked}</span> : null}
      </label>
      {!compact && checked ? <p className="text-xs text-ink-dim">{HINT}</p> : null}
    </div>
  );
}
