/**
 * The agent's original pick (C7), as the review step's editor reads it: which
 * rows carry an "agent pick" badge, and whether "Reset to agent pick" would
 * change anything. Pure, beside the reducer it feeds.
 */
import type { Selections } from '../types.ts';

/** The six slices of a `Selections`, in the order the API lists them. */
export const SLICES = [
  'experiences',
  'experienceBullets',
  'projects',
  'projectBullets',
  'skillRows',
  'skills',
] as const satisfies readonly (keyof Selections)[];

/**
 * Every experience, project and bullet the agent picked. Skills carry no
 * badge: a skill row is a line of names, and a badge per name would bury it.
 */
export function agentPickIds(proposed: Selections | null): ReadonlySet<string> {
  if (!proposed) return new Set();
  return new Set([
    ...proposed.experiences,
    ...Object.values(proposed.experienceBullets).flat(),
    ...proposed.projects,
    ...Object.values(proposed.projectBullets).flat(),
  ]);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** A parent with no children selected is the same as one that is absent:
 *  the reducer leaves `[]` behind when the last bullet is unticked, and the
 *  server never returns one. */
function sameMap(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => sameList(a[key] ?? [], b[key] ?? []));
}

/** Whether two selections would render the same resume, order included. */
export function sameSelections(a: Selections, b: Selections): boolean {
  return SLICES.every((slice) => {
    const left = a[slice];
    const right = b[slice];
    return Array.isArray(left) && Array.isArray(right)
      ? sameList(left, right)
      : sameMap(left as Record<string, string[]>, right as Record<string, string[]>);
  });
}
