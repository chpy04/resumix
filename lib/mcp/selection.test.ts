/**
 * The selection checks, against a hand-built live library. No database: the
 * caller supplies the library, which is what makes "not in it" one rule.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Library } from '../types.ts';
import {
  findSelectionProblems,
  fromSelections,
  selectionInput,
  toSelections,
  type SelectionInput,
} from './selection.ts';

const id = {
  exp: randomUUID(),
  expBullet1: randomUUID(),
  expBullet2: randomUUID(),
  otherExp: randomUUID(),
  otherExpBullet: randomUUID(),
  proj: randomUUID(),
  projBullet: randomUUID(),
  row: randomUUID(),
  skill: randomUUID(),
};

function bullet(bulletId: string) {
  return { id: bulletId, content: 'did a thing', isArchived: false };
}

const library: Library = {
  experiences: [
    {
      id: id.exp,
      company: 'Acme',
      title: 'Engineer',
      dateRange: '2024',
      location: 'Remote',
      isArchived: false,
      bullets: [bullet(id.expBullet1), bullet(id.expBullet2)],
    },
    {
      id: id.otherExp,
      company: 'Beta',
      title: 'Engineer',
      dateRange: '2023',
      location: 'Remote',
      isArchived: false,
      bullets: [bullet(id.otherExpBullet)],
    },
  ],
  projects: [
    {
      id: id.proj,
      name: 'Thing',
      technologies: 'TS',
      dateRange: '2024',
      isArchived: false,
      bullets: [bullet(id.projBullet)],
    },
  ],
  skillRows: [
    {
      id: id.row,
      name: 'Languages',
      top: true,
      separator: ', ',
      isArchived: false,
      skills: [{ id: id.skill, name: 'TypeScript', isArchived: false }],
    },
  ],
  templates: [],
};

function valid(): SelectionInput {
  return {
    experiences: [id.exp],
    experience_bullets: { [id.exp]: [id.expBullet2, id.expBullet1] },
    projects: [id.proj],
    project_bullets: { [id.proj]: [id.projBullet] },
    skill_rows: [id.row],
    skills: { [id.row]: [id.skill] },
  };
}

test('a selection of live content, each child under its own selected parent, has no problems', () => {
  assert.deepEqual(findSelectionProblems(library, valid()), []);
});

test('an empty selection has no problems', () => {
  const empty = {
    experiences: [],
    experience_bullets: {},
    projects: [],
    project_bullets: {},
    skill_rows: [],
    skills: {},
  };
  assert.deepEqual(findSelectionProblems(library, empty), []);
});

test('an id not in the live library is a problem, whichever slice it is in', () => {
  const stranger = randomUUID();
  for (const key of ['experiences', 'projects', 'skill_rows'] as const) {
    const s = valid();
    s[key] = [...s[key], stranger];
    assert.deepEqual(findSelectionProblems(library, s), [
      `${key}: ${stranger} is not in get_library`,
    ]);
  }
});

test('a child keyed under a parent that is not selected is a problem', () => {
  const s = valid();
  s.experience_bullets[id.otherExp] = [id.otherExpBullet];
  assert.deepEqual(findSelectionProblems(library, s), [
    `experience_bullets.${id.otherExp}: that experience is not in experiences`,
  ]);
});

test("a child under the wrong parent, or not live, is a problem naming that parent's slice", () => {
  const s = valid();
  s.experiences = [id.exp, id.otherExp];
  s.experience_bullets[id.otherExp] = [id.expBullet1];
  const archived = randomUUID();
  s.skills[id.row] = [id.skill, archived];
  assert.deepEqual(findSelectionProblems(library, s), [
    `experience_bullets.${id.otherExp}: ${id.expBullet1} is not one of that experience's bullets in get_library`,
    `skills.${id.row}: ${archived} is not one of that skill row's skills in get_library`,
  ]);
});

test('a parent that is not live reports once, not once per child', () => {
  const gone = randomUUID();
  const s = valid();
  s.projects = [id.proj, gone];
  s.project_bullets[gone] = [randomUUID(), randomUUID()];
  assert.deepEqual(findSelectionProblems(library, s), [`projects: ${gone} is not in get_library`]);
});

test('an id listed twice is a problem, at the top level or under a parent', () => {
  const s = valid();
  s.skill_rows = [id.row, id.row];
  s.experience_bullets[id.exp] = [id.expBullet1, id.expBullet1];
  assert.deepEqual(findSelectionProblems(library, s), [
    `experience_bullets.${id.exp}: ${id.expBullet1} is listed twice`,
    `skill_rows: ${id.row} is listed twice`,
  ]);
});

test('every problem is reported at once', () => {
  const s = valid();
  s.experiences = [randomUUID()];
  s.projects = [randomUUID()];
  s.skill_rows = [randomUUID()];
  // Each nested map is now keyed under an item that is no longer selected.
  assert.equal(findSelectionProblems(library, s).length, 6);
});

test('the input requires all six slices and rejects unknown keys and non-uuids', () => {
  assert.equal(selectionInput.safeParse(valid()).success, true);

  const { skills: _, ...missing } = valid();
  assert.equal(selectionInput.safeParse(missing).success, false);
  assert.equal(selectionInput.safeParse({ ...valid(), skillRows: [] }).success, false);
  assert.equal(selectionInput.safeParse({ ...valid(), experiences: ['nope'] }).success, false);
  assert.equal(
    selectionInput.safeParse({ ...valid(), skills: { nope: [id.skill] } }).success,
    false,
  );
});

test('toSelections and fromSelections are inverses', () => {
  const s = valid();
  const selections = toSelections(s);
  assert.deepEqual(selections.experienceBullets, s.experience_bullets);
  assert.deepEqual(selections.skillRows, s.skill_rows);
  assert.deepEqual(fromSelections(selections), s);
});
