import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affectedSlice, selectionsReducer, type SelectionsAction } from './selections-reducer.ts';
import { EMPTY_SELECTIONS, type Selections } from '../types.ts';

function withExperiences(order: string[]): Selections {
  return { ...EMPTY_SELECTIONS, experiences: order };
}

test('toggleTop adds an id to the end when absent', () => {
  const next = selectionsReducer(withExperiences(['a', 'b']), {
    type: 'toggleTop',
    slice: 'experiences',
    id: 'c',
  });
  assert.deepEqual(next.experiences, ['a', 'b', 'c']);
});

test('toggleTop removes an id when present, preserving remaining order', () => {
  const next = selectionsReducer(withExperiences(['a', 'b', 'c']), {
    type: 'toggleTop',
    slice: 'experiences',
    id: 'b',
  });
  assert.deepEqual(next.experiences, ['a', 'c']);
});

test('toggleTop does not mutate the input state', () => {
  const state = withExperiences(['a']);
  selectionsReducer(state, { type: 'toggleTop', slice: 'experiences', id: 'b' });
  assert.deepEqual(state.experiences, ['a']);
});

test('toggleTop only touches the named slice', () => {
  const state: Selections = { ...EMPTY_SELECTIONS, projects: ['p1'] };
  const next = selectionsReducer(state, { type: 'toggleTop', slice: 'experiences', id: 'e1' });
  assert.deepEqual(next.projects, ['p1']);
  assert.deepEqual(next.experiences, ['e1']);
});

test('reorderTop replaces the order wholesale', () => {
  const next = selectionsReducer(withExperiences(['a', 'b', 'c']), {
    type: 'reorderTop',
    slice: 'experiences',
    order: ['c', 'a', 'b'],
  });
  assert.deepEqual(next.experiences, ['c', 'a', 'b']);
});

test('toggleNested initializes a missing parent key on first selection', () => {
  const next = selectionsReducer(EMPTY_SELECTIONS, {
    type: 'toggleNested',
    slice: 'experienceBullets',
    parentId: 'exp1',
    id: 'bullet1',
  });
  assert.deepEqual(next.experienceBullets, { exp1: ['bullet1'] });
});

test('toggleNested only touches the named parent, leaving sibling parents untouched', () => {
  const state: Selections = {
    ...EMPTY_SELECTIONS,
    experienceBullets: { exp1: ['b1'], exp2: ['b2'] },
  };
  const next = selectionsReducer(state, {
    type: 'toggleNested',
    slice: 'experienceBullets',
    parentId: 'exp1',
    id: 'b1x',
  });
  assert.deepEqual(next.experienceBullets, { exp1: ['b1', 'b1x'], exp2: ['b2'] });
});

test('toggleNested removes a child id when already present', () => {
  const state: Selections = { ...EMPTY_SELECTIONS, skills: { row1: ['s1', 's2'] } };
  const next = selectionsReducer(state, {
    type: 'toggleNested',
    slice: 'skills',
    parentId: 'row1',
    id: 's1',
  });
  assert.deepEqual(next.skills, { row1: ['s2'] });
});

test('reorderNested overwrites only the given parent', () => {
  const state: Selections = {
    ...EMPTY_SELECTIONS,
    projectBullets: { p1: ['b1', 'b2'], p2: ['b3'] },
  };
  const next = selectionsReducer(state, {
    type: 'reorderNested',
    slice: 'projectBullets',
    parentId: 'p1',
    order: ['b2', 'b1'],
  });
  assert.deepEqual(next.projectBullets, { p1: ['b2', 'b1'], p2: ['b3'] });
});

test('replace swaps the entire state', () => {
  const loaded: Selections = { ...EMPTY_SELECTIONS, experiences: ['x'] };
  const next = selectionsReducer(withExperiences(['a', 'b']), { type: 'replace', selections: loaded });
  assert.equal(next, loaded);
});

test('affectedSlice names the top-level key for every mutating action, and null for replace', () => {
  const cases: Array<[SelectionsAction, keyof Selections | null]> = [
    [{ type: 'replace', selections: EMPTY_SELECTIONS }, null],
    [{ type: 'toggleTop', slice: 'experiences', id: 'a' }, 'experiences'],
    [{ type: 'reorderTop', slice: 'projects', order: [] }, 'projects'],
    [{ type: 'toggleNested', slice: 'skills', parentId: 'r1', id: 's1' }, 'skills'],
    [{ type: 'reorderNested', slice: 'experienceBullets', parentId: 'e1', order: [] }, 'experienceBullets'],
  ];
  for (const [action, expected] of cases) {
    assert.equal(affectedSlice(action), expected);
  }
});
