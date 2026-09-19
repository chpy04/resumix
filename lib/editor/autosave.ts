/**
 * A debounced, coalescing autosave queue, plus a small aggregator for
 * turning several independent queues' statuses into one honest indicator
 * ("Saved" / "Saving…" / "Save failed — retry"). Framework-free and
 * side-effect-free apart from calling the `save` function it's given and
 * scheduling timers — see `lib/editor/autosave.test.ts`.
 *
 * Design, per the task brief: "Debounce (~500ms for text, immediate for
 * toggles/reorder), coalesce in-flight requests, ... Never silently drop a
 * failed save."
 *
 * - `debounceMs` controls the delay before the *first* send of a burst of
 *   `schedule()` calls. Pass `0` for "immediate" (toggles/reorder) or
 *   `500` for text fields.
 * - Coalescing: only one `save()` call is ever in flight per queue. If
 *   `schedule()` is called again while a save is in flight, the new value
 *   replaces whatever was pending — it does not queue a growing backlog of
 *   requests, and it does not fire a second request in parallel (which
 *   could race the first and land out of order). When the in-flight call
 *   finishes, the latest pending value (if any) is sent immediately.
 * - Failure handling: a failed save moves the queue to `'error'` and keeps
 *   the failed value around so `retry()` can resend it without the caller
 *   needing to remember what changed. A *newer* `schedule()` call after a
 *   failure supersedes the failed value (the newer state is a strict
 *   superset of intent, so there is nothing to lose), but the failure is
 *   never hidden — the status callback always fires with `'error'` first.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveController<T> {
  /** Queue `value` to be saved, per the debounce/coalescing rules above. */
  schedule(value: T): void;
  /** Resend the most recent value (pending, or last-failed) right away. */
  retry(): void;
  /** Skip any pending debounce and send immediately, if something is queued. */
  flushNow(): void;
}

export interface AutosaveOptions<T> {
  save: (value: T) => Promise<void>;
  /** Delay in ms before sending after the last `schedule()` call. Default 0 (immediate). */
  debounceMs?: number;
  onStatusChange?: (status: SaveStatus, message?: string) => void;
}

export function createAutosave<T>(options: AutosaveOptions<T>): AutosaveController<T> {
  const { save, debounceMs = 0, onStatusChange } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let pendingValue: { value: T } | null = null;
  let lastAttempted: T | null = null;

  function setStatus(status: SaveStatus, message?: string): void {
    onStatusChange?.(status, message);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function run(value: T): void {
    inFlight = true;
    lastAttempted = value;
    setStatus('saving');

    save(value)
      .then(() => {
        setStatus('saved');
      })
      .catch((error: unknown) => {
        setStatus('error', error instanceof Error ? error.message : 'Save failed');
      })
      .finally(() => {
        inFlight = false;
        if (pendingValue !== null) {
          const next = pendingValue.value;
          pendingValue = null;
          run(next);
        }
      });
  }

  function flush(): void {
    clearTimer();
    if (pendingValue === null) return;
    if (inFlight) return; // `run`'s `finally` will pick up `pendingValue` when it's done.
    const value = pendingValue.value;
    pendingValue = null;
    run(value);
  }

  return {
    schedule(value: T): void {
      pendingValue = { value };
      clearTimer();
      if (debounceMs <= 0) {
        flush();
      } else {
        timer = setTimeout(flush, debounceMs);
      }
    },

    retry(): void {
      clearTimer();
      if (pendingValue !== null) {
        flush();
        return;
      }
      if (lastAttempted !== null && !inFlight) {
        run(lastAttempted);
      }
    },

    flushNow(): void {
      flush();
    },
  };
}

/**
 * Combines several named queues' statuses into one to show the user.
 * Priority: any `'saving'` wins (something is in flight); otherwise any
 * `'error'` wins (never hide a failure behind an unrelated success);
 * otherwise `'saved'` if at least one channel has ever saved; otherwise
 * `'idle'`.
 */
export function combineStatuses(statuses: Iterable<SaveStatus>): SaveStatus {
  let sawError = false;
  let sawSaved = false;

  for (const status of statuses) {
    if (status === 'saving') return 'saving';
    if (status === 'error') sawError = true;
    if (status === 'saved') sawSaved = true;
  }

  if (sawError) return 'error';
  if (sawSaved) return 'saved';
  return 'idle';
}
