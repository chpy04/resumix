/**
 * Pure state management for a resume's `Selections` while the editor is
 * open. Kept free of React and of `fetch` on purpose — see
 * `lib/editor/autosave.ts` for the side-effecting half, and
 * `components/editor/ContentPane.tsx` for how the two are wired together.
 *
 * The one non-obvious rule this module encodes: `PUT /api/resumes/:id/selections`
 * replaces a whole slice at a time (docs/API.md — "Replaces each provided
 * slice wholesale"). For the two nested slices (`experienceBullets`,
 * `projectBullets`, `skills`) that means the *entire map*, across every
 * parent, not just the parent that changed. `affectedSlice` below always
 * names one of the six top-level `Selections` keys for exactly this reason:
 * callers must autosave the complete current value of that key, never a
 * per-parent fragment.
 */
import type { Selections } from '../types.ts';

/** The three slices that are a flat, ordered list of ids. */
export type TopLevelSlice = 'experiences' | 'projects' | 'skillRows';

/** The three slices that are `parentId -> ordered child ids`. */
export type NestedSlice = 'experienceBullets' | 'projectBullets' | 'skills';

export type SelectionsAction =
  /** Replaces the whole state wholesale — used once, on initial load. */
  | { type: 'replace'; selections: Selections }
  /** Adds `id` to the slice if absent, removes it if present. Appends to
   *  the end of the order when adding, so newly-selected items land last. */
  | { type: 'toggleTop'; slice: TopLevelSlice; id: string }
  /** Overwrites the full order for a top-level slice, e.g. after a
   *  drag-and-drop reorder. */
  | { type: 'reorderTop'; slice: TopLevelSlice; order: string[] }
  | { type: 'toggleNested'; slice: NestedSlice; parentId: string; id: string }
  | { type: 'reorderNested'; slice: NestedSlice; parentId: string; order: string[] };

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

export function selectionsReducer(state: Selections, action: SelectionsAction): Selections {
  switch (action.type) {
    case 'replace':
      return action.selections;

    case 'toggleTop':
      return { ...state, [action.slice]: toggleId(state[action.slice], action.id) };

    case 'reorderTop':
      return { ...state, [action.slice]: action.order };

    case 'toggleNested': {
      const map = state[action.slice];
      const current = map[action.parentId] ?? [];
      return {
        ...state,
        [action.slice]: { ...map, [action.parentId]: toggleId(current, action.id) },
      };
    }

    case 'reorderNested': {
      const map = state[action.slice];
      return { ...state, [action.slice]: { ...map, [action.parentId]: action.order } };
    }

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/**
 * Which top-level `Selections` key an action touched, i.e. which key an
 * autosave caller must `PUT` (with its *entire* current value — see the
 * module docstring). `null` for `replace`, which is only ever the initial
 * load and never something to save back.
 */
export function affectedSlice(action: SelectionsAction): keyof Selections | null {
  switch (action.type) {
    case 'replace':
      return null;
    case 'toggleTop':
    case 'reorderTop':
    case 'toggleNested':
    case 'reorderNested':
      return action.slice;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}
