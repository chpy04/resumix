/**
 * Pure helpers for the "hide archived content, except when it's currently
 * selected on this resume" rule (D-011 — see docs/DECISIONS.md). Getting
 * this wrong means a user can have content rendering onto their PDF that
 * they can no longer find or deselect in the UI, which is the one failure
 * mode this file exists to prevent.
 *
 * Also holds the merged-ordering logic used to drive a single
 * drag-and-drop list per section that mixes selected and unselected items
 * (see `orderForDisplay`/`extractSelectedOrder`).
 */

export interface Archivable {
  id: string;
  isArchived: boolean;
}

/** An archived item is visible only if the "show archived" toggle is on,
 *  or it's currently selected on this resume — it must never silently
 *  disappear from a resume that still references it. */
export function isVisible(item: Archivable, selectedIds: ReadonlySet<string>, showArchived: boolean): boolean {
  if (!item.isArchived) return true;
  return showArchived || selectedIds.has(item.id);
}

/** Filters `items` down to what should render, given the current
 *  selection and the "show archived" toggle. */
export function visibleItems<T extends Archivable>(
  items: readonly T[],
  selectedIds: readonly string[],
  showArchived: boolean,
): T[] {
  const selectedSet = new Set(selectedIds);
  return items.filter((item) => isVisible(item, selectedSet, showArchived));
}

/**
 * Orders a set of items for display: everything currently selected comes
 * first, in the resume's chosen order, followed by everything else in the
 * order `items` was given (library order). Selected ids that no longer
 * exist in `items` (e.g. filtered out, or stale) are skipped rather than
 * inserted as gaps.
 *
 * This is purely a rendering concern — only the *selected* subset of the
 * resulting order is ever sent back to the server (see
 * `extractSelectedOrder`); unselected items have no persisted order.
 */
export function orderForDisplay<T extends { id: string }>(items: readonly T[], selectedOrder: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of selectedOrder) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(item.id)) {
      ordered.push(item);
      seen.add(item.id);
    }
  }

  return ordered;
}

/**
 * After a drag-and-drop reorder of the *full* displayed list (selected and
 * unselected ids mixed together), extracts just the selected ids in their
 * new relative order — the value that actually gets saved.
 */
export function extractSelectedOrder(fullOrderedIds: readonly string[], selectedIds: readonly string[]): string[] {
  const selectedSet = new Set(selectedIds);
  return fullOrderedIds.filter((id) => selectedSet.has(id));
}
