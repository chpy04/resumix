import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentPickIds, sameSelections } from './agent-pick.ts';
import { EMPTY_SELECTIONS, type Selections } from '../types.ts';

const PICK: Selections = {
  experiences: ['exp-1', 'exp-2'],
  experienceBullets: { 'exp-1': ['b-1', 'b-2'], 'exp-2': ['b-3'] },
  projects: ['proj-1'],
  projectBullets: { 'proj-1': ['pb-1'] },
  skillRows: ['row-1'],
  skills: { 'row-1': ['skill-1'] },
};

test('agent picks are the experiences, projects and their bullets', () => {
  assert.deepEqual(
    [...agentPickIds(PICK)].sort(),
    ['b-1', 'b-2', 'b-3', 'exp-1', 'exp-2', 'pb-1', 'proj-1'].sort(),
  );
});

test('skill rows and skills carry no badge', () => {
  const picks = agentPickIds(PICK);
  assert.equal(picks.has('row-1'), false);
  assert.equal(picks.has('skill-1'), false);
});

test('no proposal means no picks', () => {
  assert.equal(agentPickIds(null).size, 0);
  assert.equal(agentPickIds(EMPTY_SELECTIONS).size, 0);
});

test('a selection is the same as itself and as a deep copy', () => {
  assert.equal(sameSelections(PICK, PICK), true);
  assert.equal(sameSelections(PICK, structuredClone(PICK)), true);
});

test('order matters: a reorder is a change', () => {
  assert.equal(sameSelections(PICK, { ...PICK, experiences: ['exp-2', 'exp-1'] }), false);
  assert.equal(
    sameSelections(PICK, {
      ...PICK,
      experienceBullets: { ...PICK.experienceBullets, 'exp-1': ['b-2', 'b-1'] },
    }),
    false,
  );
});

test('an unticked bullet or skill is a change, in every slice', () => {
  assert.equal(
    sameSelections(PICK, {
      ...PICK,
      experienceBullets: { ...PICK.experienceBullets, 'exp-2': [] },
    }),
    false,
  );
  assert.equal(sameSelections(PICK, { ...PICK, projects: [] }), false);
  assert.equal(sameSelections(PICK, { ...PICK, projectBullets: {} }), false);
  assert.equal(sameSelections(PICK, { ...PICK, skillRows: [] }), false);
  assert.equal(sameSelections(PICK, { ...PICK, skills: { 'row-1': [] } }), false);
});

test('an empty child list is the same as an absent one', () => {
  const withEmpty = { ...PICK, projectBullets: { ...PICK.projectBullets, 'proj-9': [] } };
  assert.equal(sameSelections(PICK, withEmpty), true);
  assert.equal(sameSelections(withEmpty, PICK), true);
});
