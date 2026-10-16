/**
 * A resume selection as the agent writes it, and the checks it must pass
 * before anything is written (D-042).
 *
 * Pure: the caller hands in the live library. That library is the caller's
 * own (`assembleLibrary(userId, false)`), non-archived only, so "not in it"
 * is one rule that covers an unknown id, an archived one and another user's,
 * and all three read the same.
 *
 * These checks are stricter than `replaceSelections`, on purpose. Autosave
 * must keep accepting an archived id already on a resume (D-011), and the
 * editor never sends a bullet keyed under an unselected experience. The
 * agent is choosing fresh, so it may only choose live content, and every
 * bullet must sit under an item it actually selected.
 */
import { z } from 'zod';
import type { Library, Selections } from '../types.ts';

const ids = z.array(z.uuid());
const idsByParent = z.record(z.uuid(), ids);

/** All six slices are required: the selection replaces the whole resume's,
 *  and `proposed_selection` must be a complete `Selections` (C7). */
export const selectionInput = z.strictObject({
  experiences: ids.describe('Experience ids, in print order.'),
  experience_bullets: idsByParent.describe(
    'Experience id → its bullet ids, in print order. Every key must be in experiences.',
  ),
  projects: ids.describe('Project ids, in print order.'),
  project_bullets: idsByParent.describe(
    'Project id → its bullet ids, in print order. Every key must be in projects.',
  ),
  skill_rows: ids.describe('Skill row ids, in print order.'),
  skills: idsByParent.describe(
    'Skill row id → its skill ids, in print order. Every key must be in skill_rows.',
  ),
});

export type SelectionInput = z.output<typeof selectionInput>;

export function toSelections(s: SelectionInput): Selections {
  return {
    experiences: s.experiences,
    experienceBullets: s.experience_bullets,
    projects: s.projects,
    projectBullets: s.project_bullets,
    skillRows: s.skill_rows,
    skills: s.skills,
  };
}

export function fromSelections(s: Selections): SelectionInput {
  return {
    experiences: s.experiences,
    experience_bullets: s.experienceBullets,
    projects: s.projects,
    project_bullets: s.projectBullets,
    skill_rows: s.skillRows,
    skills: s.skills,
  };
}

/** One top-level slice and its nested map, checked the same way for all three. */
interface Slice {
  /** The input keys, for the `path:` each problem starts with. */
  itemsKey: string;
  childrenKey: string;
  /** How a problem names one item, and that item's children. */
  itemNoun: string;
  childNoun: string;
  selected: string[];
  byParent: Record<string, string[]>;
  /** Live item id → its live child ids. */
  live: Map<string, Set<string>>;
}

function duplicates(list: string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of list) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

function sliceProblems(slice: Slice): string[] {
  const problems: string[] = [];
  const selected = new Set(slice.selected);

  for (const id of selected) {
    if (!slice.live.has(id)) problems.push(`${slice.itemsKey}: ${id} is not in get_library`);
  }
  // A repeated id would break the bridge table's primary key: a 500, not a
  // message the agent can act on.
  for (const id of duplicates(slice.selected)) {
    problems.push(`${slice.itemsKey}: ${id} is listed twice`);
  }

  for (const [parent, children] of Object.entries(slice.byParent)) {
    const path = `${slice.childrenKey}.${parent}`;
    if (!selected.has(parent)) {
      problems.push(`${path}: that ${slice.itemNoun} is not in ${slice.itemsKey}`);
      continue;
    }
    // Already reported above; its children would only repeat the news.
    const live = slice.live.get(parent);
    if (!live) continue;
    for (const id of new Set(children)) {
      if (!live.has(id)) {
        problems.push(
          `${path}: ${id} is not one of that ${slice.itemNoun}'s ${slice.childNoun} in get_library`,
        );
      }
    }
    for (const id of duplicates(children)) problems.push(`${path}: ${id} is listed twice`);
  }
  return problems;
}

/** Every reason this selection cannot be written, or `[]`. All of them at
 *  once, so the agent fixes them in one retry. */
export function findSelectionProblems(library: Library, s: SelectionInput): string[] {
  return [
    ...sliceProblems({
      itemsKey: 'experiences',
      childrenKey: 'experience_bullets',
      itemNoun: 'experience',
      childNoun: 'bullets',
      selected: s.experiences,
      byParent: s.experience_bullets,
      live: new Map(library.experiences.map((e) => [e.id, new Set(e.bullets.map((b) => b.id))])),
    }),
    ...sliceProblems({
      itemsKey: 'projects',
      childrenKey: 'project_bullets',
      itemNoun: 'project',
      childNoun: 'bullets',
      selected: s.projects,
      byParent: s.project_bullets,
      live: new Map(library.projects.map((p) => [p.id, new Set(p.bullets.map((b) => b.id))])),
    }),
    ...sliceProblems({
      itemsKey: 'skill_rows',
      childrenKey: 'skills',
      itemNoun: 'skill row',
      childNoun: 'skills',
      selected: s.skill_rows,
      byParent: s.skills,
      live: new Map(library.skillRows.map((r) => [r.id, new Set(r.skills.map((k) => k.id))])),
    }),
  ];
}
