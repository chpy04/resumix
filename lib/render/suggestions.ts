/**
 * The agent's pending bullet suggestions, laid over a library and a
 * selection so a render shows the resume as it would read with them
 * (D-045). Pure, like the rest of `lib/render`, and never stored: only the
 * review preview and the agent's page counts pass suggestions in, so no
 * snapshot ever contains one.
 *
 * A suggestion's text is plain, so it is escaped here (`escapeLatex`), the
 * one way plain text enters a resume. Library content is still substituted
 * raw (D-008); an edit replaces a bullet's content in a copy, never escapes
 * it.
 */
import type { Bullet, BulletSuggestion, Library, Selections } from '../types.ts';
import { escapeLatex } from './escape.ts';

/** `ids` with `id` at `position`, or last when `position` is past the end. */
export function insertAt(ids: readonly string[], id: string, position: number): string[] {
  const at = Math.min(Math.max(position, 0), ids.length);
  return [...ids.slice(0, at), id, ...ids.slice(at)];
}

/** `ids` with `newId` where `oldId` was, or at the end when `oldId` is not
 *  there: Save as new on a bullet that has since been unticked still puts
 *  the new one on the resume. */
export function swapIn(ids: readonly string[], oldId: string, newId: string): string[] {
  const at = ids.indexOf(oldId);
  if (at === -1) return [...ids, newId];
  return [...ids.slice(0, at), newId, ...ids.slice(at + 1)];
}

/** The id an addition's bullet carries in an overlay. Never stored, and
 *  never a uuid, so it cannot collide with a real bullet. */
export function suggestedBulletId(suggestionId: string): string {
  return `suggestion:${suggestionId}`;
}

/**
 * Each addition placed among `ids` at its own position, measured against
 * `ids` as given, so several at one position keep the order they arrive in
 * (creation order) instead of each pushing the one before it down.
 */
function placeAdditions(ids: readonly string[], adds: readonly BulletSuggestion[]): string[] {
  const before = new Map<number, string[]>();
  for (const add of adds) {
    const at = Math.min(Math.max(add.position ?? ids.length, 0), ids.length);
    before.set(at, [...(before.get(at) ?? []), suggestedBulletId(add.id)]);
  }
  const placed: string[] = [];
  ids.forEach((id, index) => placed.push(...(before.get(index) ?? []), id));
  placed.push(...(before.get(ids.length) ?? []));
  return placed;
}

interface Parent {
  id: string;
  bullets: Bullet[];
}

/** One kind's parents with its edits and additions applied, and the
 *  selection's bullet map for them with the additions placed. */
function overlayKind<P extends Parent>(
  kind: BulletSuggestion['bulletKind'],
  parents: P[],
  byParent: Record<string, string[]>,
  suggestions: readonly BulletSuggestion[],
  warnings: string[],
): { parents: P[]; byParent: Record<string, string[]> } {
  const edits = new Map<string, BulletSuggestion>();
  const adds = new Map<string, BulletSuggestion[]>();
  for (const s of suggestions) {
    if (s.kind === 'edit' && s.bulletId) edits.set(s.bulletId, s);
    if (s.kind === 'add' && s.parentId) adds.set(s.parentId, [...(adds.get(s.parentId) ?? []), s]);
  }

  const applied = new Set<string>();
  const nextParents = parents.map((parent) => {
    const added = adds.get(parent.id) ?? [];
    if (added.length === 0 && !parent.bullets.some((b) => edits.has(b.id))) return parent;

    const bullets = parent.bullets.map((bullet) => {
      const edit = edits.get(bullet.id);
      if (!edit) return bullet;
      applied.add(edit.id);
      return { ...bullet, content: escapeLatex(edit.proposedText) };
    });
    for (const add of added) {
      applied.add(add.id);
      bullets.push({
        id: suggestedBulletId(add.id),
        content: escapeLatex(add.proposedText),
        isArchived: false,
      });
    }
    return { ...parent, bullets };
  });

  const nextByParent = { ...byParent };
  for (const parent of parents) {
    const added = adds.get(parent.id);
    if (added) nextByParent[parent.id] = placeAdditions(byParent[parent.id] ?? [], added);
  }

  for (const s of suggestions) {
    if (applied.has(s.id)) continue;
    const target = s.kind === 'edit' ? `${kind} bullet "${s.bulletId}"` : `${kind} "${s.parentId}"`;
    warnings.push(`suggestions/${s.id}: no ${target} (suggestion skipped)`);
  }

  return { parents: nextParents, byParent: nextByParent };
}

/**
 * `library` and `selections` as they read with every pending suggestion
 * applied: an edit's bullet carries the escaped proposed text, and an
 * addition is a bullet of its own, selected at its position under its
 * parent. Resolved suggestions are ignored. Neither input is changed.
 *
 * A suggestion whose target is not in the library is skipped with a
 * warning, like a dangling selection: it must never break the preview.
 */
export function overlaySuggestions(
  library: Library,
  selections: Selections,
  suggestions: readonly BulletSuggestion[],
  warnings: string[],
): { library: Library; selections: Selections } {
  const pending = suggestions.filter((s) => s.status === 'pending');
  if (pending.length === 0) return { library, selections };

  const experiences = overlayKind(
    'experience',
    library.experiences,
    selections.experienceBullets,
    pending.filter((s) => s.bulletKind === 'experience'),
    warnings,
  );
  const projects = overlayKind(
    'project',
    library.projects,
    selections.projectBullets,
    pending.filter((s) => s.bulletKind === 'project'),
    warnings,
  );

  return {
    library: { ...library, experiences: experiences.parents, projects: projects.parents },
    selections: {
      ...selections,
      experienceBullets: experiences.byParent,
      projectBullets: projects.byParent,
    },
  };
}
