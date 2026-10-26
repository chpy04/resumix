import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Library, Selections } from '../types.ts';
import { BULLET_CHARS_PER_LINE, estimateLines, suggestDrops } from './overflow.ts';

const long = 'x'.repeat(BULLET_CHARS_PER_LINE + 1);

function bullet(id: string, content = 'Did a thing') {
  return { id, content, isArchived: false };
}

const library: Library = {
  experiences: [
    {
      id: 'acme',
      company: 'Acme \\& Sons',
      title: 'Engineer',
      dateRange: '2024',
      location: 'Remote',
      isArchived: false,
      bullets: [bullet('a1'), bullet('a2', `\\textbf{${long}}`), bullet('a3')],
    },
    {
      id: 'beta',
      company: 'Beta',
      title: 'Engineer',
      dateRange: '2023',
      location: 'Remote',
      isArchived: false,
      bullets: [bullet('b1'), bullet('b2')],
    },
    {
      id: 'solo',
      company: 'Solo',
      title: 'Engineer',
      dateRange: '2022',
      location: 'Remote',
      isArchived: false,
      bullets: [bullet('s1')],
    },
  ],
  projects: [
    {
      id: 'thing',
      name: 'Thing',
      technologies: 'TS',
      dateRange: '2024',
      isArchived: false,
      bullets: [bullet('t1'), bullet('t2')],
    },
  ],
  skillRows: [],
  templates: [],
};

function selection(overrides: Partial<Selections> = {}): Selections {
  return {
    experiences: ['acme', 'beta', 'solo'],
    experienceBullets: { acme: ['a1', 'a3', 'a2'], beta: ['b1', 'b2'], solo: ['s1'] },
    projects: ['thing'],
    projectBullets: { thing: ['t1', 't2'] },
    skillRows: [],
    skills: {},
    ...overrides,
  };
}

test('a resume that fits has no overflow', () => {
  assert.equal(suggestDrops(library, selection(), 1), null);
});

test('est_lines is at least one, and grows with the plain text, not the LaTeX', () => {
  assert.equal(estimateLines(''), 1);
  assert.equal(estimateLines('x'.repeat(BULLET_CHARS_PER_LINE)), 1);
  assert.equal(estimateLines(long), 2);
});

test('the last bullet under each item comes first, longest first, then lowest on the page', () => {
  const overflow = suggestDrops(library, selection(), 2);
  assert.deepEqual(
    overflow?.candidates.map((c) => c.id),
    // a2 is last under Acme and two lines long; then the one-line last
    // bullets, bottom of the page up; then the second-to-last ones.
    ['a2', 't2', 'b2', 't1', 'b1'],
  );
});

test('an item down to one bullet offers none of its own', () => {
  const overflow = suggestDrops(library, selection(), 2);
  assert.ok(!overflow?.candidates.some((c) => c.parent_id === 'solo'));
});

test('a candidate carries its kind, parent and plain text', () => {
  const [first] = suggestDrops(library, selection(), 2)?.candidates ?? [];
  assert.deepEqual(first, {
    id: 'a2',
    kind: 'experience_bullet',
    parent_id: 'acme',
    parent: 'Acme & Sons',
    est_lines: 2,
    text: long,
  });
  const project = suggestDrops(library, selection(), 2)?.candidates.find((c) => c.id === 't2');
  assert.equal(project?.kind, 'project_bullet');
  assert.equal(project?.parent, 'Thing');
});

test('the advice names the page count and the first candidate', () => {
  const advice = suggestDrops(library, selection(), 2)?.advice;
  assert.equal(
    advice,
    '2 pages: it must fit on one. Remove a bullet or a whole project and call ' +
      'set_resume_selection again. Try a2 first, the last bullet under Acme & Sons, about 2 lines.',
  );
});

test('with every item at one bullet there are no candidates, and the advice says so', () => {
  const overflow = suggestDrops(
    library,
    selection({
      experienceBullets: { acme: ['a1'], beta: ['b1'], solo: ['s1'] },
      projectBullets: { thing: ['t1'] },
    }),
    2,
  );
  assert.deepEqual(overflow?.candidates, []);
  assert.match(overflow?.advice ?? '', /down to one bullet, so remove a whole experience/);
});

test('at most five candidates', () => {
  const many = Array.from({ length: 8 }, (_, i) => bullet(`m${i}`));
  const overflow = suggestDrops(
    { ...library, experiences: [{ ...library.experiences[0]!, bullets: many }] },
    selection({
      experiences: ['acme'],
      experienceBullets: { acme: many.map((b) => b.id) },
      projects: [],
      projectBullets: {},
    }),
    2,
  );
  assert.deepEqual(
    overflow?.candidates.map((c) => c.id),
    ['m7', 'm6', 'm5', 'm4', 'm3'],
  );
});
