'use client';

import { useCallback, useReducer, useRef } from 'react';
import { combineStatuses, createAutosave, type AutosaveController, type SaveStatus } from '@/lib/editor/autosave';

interface Entry<T> {
  controller: AutosaveController<T>;
  /** Kept fresh every render so the cached controller always calls the
   *  latest closure (which may capture newer resume/library state) without
   *  losing its in-flight/coalescing state, which lives in the controller. */
  saveRef: { current: (value: T) => Promise<void> };
}

/**
 * Registry of named autosave queues that share one combined status
 * indicator (see `SaveStatusBadge`). Each distinct `key` gets its own
 * `AutosaveController`, created once and reused — callers get a stable
 * queue per key across renders even though the `save` function they pass
 * in is a fresh closure every render.
 */
export function useAutosaveRegistry() {
  const entries = useRef<Map<string, Entry<unknown>>>(new Map());
  const statuses = useRef<Map<string, SaveStatus>>(new Map());
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  const getController = useCallback(
    <T,>(key: string, save: (value: T) => Promise<void>, debounceMs = 0): AutosaveController<T> => {
      const existing = entries.current.get(key) as Entry<T> | undefined;
      if (existing) {
        existing.saveRef.current = save;
        return existing.controller;
      }

      const saveRef = { current: save };
      const controller = createAutosave<T>({
        save: (value) => saveRef.current(value),
        debounceMs,
        onStatusChange: (status) => {
          statuses.current.set(key, status);
          forceRender();
        },
      });
      entries.current.set(key, { controller, saveRef } as Entry<unknown>);
      return controller;
    },
    [],
  );

  const retryAll = useCallback(() => {
    for (const entry of entries.current.values()) entry.controller.retry();
  }, []);

  // Recomputed fresh on every render (cheap — a handful of entries at
  // most); `forceRender` is what guarantees a re-render happens whenever
  // any individual channel's status changes.
  const status = combineStatuses(statuses.current.values());

  return { getController, retryAll, status };
}
