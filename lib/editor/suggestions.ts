/**
 * Where review step 1 puts the agent's suggestion cards in a bullet list
 * (D-045). Pure, beside `visibility.ts`, which decides the order of the
 * bullets themselves.
 *
 * An edit's card sits on its bullet's row. An addition's card goes where the
 * preview prints it: before the selected bullet now at its `position`, or
 * last when the position is past the selected ones.
 */
import type { BulletSuggestion } from '../types.ts';

export interface SuggestionPlacement {
  /** Bullet id → the pending edit shown on that bullet's row. */
  edits: ReadonlyMap<string, BulletSuggestion>;
  /** Bullet id → the additions whose cards go just before that row, in
   *  creation order. */
  before: ReadonlyMap<string, BulletSuggestion[]>;
  /** Cards after the last row: additions past the end, and an edit whose
   *  bullet has no row on screen, so it can still be resolved. */
  after: BulletSuggestion[];
}

/**
 * `orderedBulletIds` are the rows on screen, in display order;
 * `selectedOrder` is the resume's selection for this parent, which is what
 * an addition's position counts. `suggestions` are this parent's pending
 * ones, oldest first.
 */
export function placeSuggestions(
  orderedBulletIds: readonly string[],
  selectedOrder: readonly string[],
  suggestions: readonly BulletSuggestion[],
): SuggestionPlacement {
  const onScreen = new Set(orderedBulletIds);
  const edits = new Map<string, BulletSuggestion>();
  const before = new Map<string, BulletSuggestion[]>();
  const after: BulletSuggestion[] = [];

  for (const s of suggestions) {
    if (s.kind === 'edit') {
      if (s.bulletId && onScreen.has(s.bulletId)) edits.set(s.bulletId, s);
      else after.push(s);
      continue;
    }
    const anchor = selectedOrder[s.position ?? selectedOrder.length];
    if (anchor && onScreen.has(anchor)) before.set(anchor, [...(before.get(anchor) ?? []), s]);
    else after.push(s);
  }
  return { edits, before, after };
}

/**
 * One kind's pending suggestions, keyed by the experience or project whose
 * bullet list shows their cards. An addition names its parent; an edit is
 * filed under whichever parent holds its bullet. One whose target is not in
 * `parents` has nowhere to go and is left out.
 */
export function suggestionsByParent(
  parents: readonly { id: string; bullets: readonly { id: string }[] }[],
  suggestions: readonly BulletSuggestion[],
): Map<string, BulletSuggestion[]> {
  const parentOfBullet = new Map(parents.flatMap((p) => p.bullets.map((b) => [b.id, p.id])));
  const known = new Set(parents.map((p) => p.id));
  const byParent = new Map<string, BulletSuggestion[]>();
  for (const s of suggestions) {
    const parentId = s.kind === 'add' ? s.parentId : parentOfBullet.get(s.bulletId ?? '');
    if (!parentId || !known.has(parentId)) continue;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), s]);
  }
  return byParent;
}

/** Whether a bullet's stored content uses LaTeX markup that applying a
 *  plain-text edit would drop (`\textbf`, `\href`, …). An escaped character
 *  (`\%`, `\$`) is not markup: the escaped text keeps it. */
export function hasLatexMarkup(content: string): boolean {
  return /\\[A-Za-z]/.test(content);
}
