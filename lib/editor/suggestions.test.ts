import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BulletSuggestion } from '../types.ts';
import { hasLatexMarkup, placeSuggestions, suggestionsByParent } from './suggestions.ts';

let next = 0;
function suggestion(overrides: Partial<BulletSuggestion>): BulletSuggestion {
  next++;
  return {
    id: `s${next}`,
    kind: 'edit',
    bulletKind: 'experience',
    bulletId: null,
    parentId: 'exp',
    position: null,
    proposedText: 'x',
    rationale: 'y',
    status: 'pending',
    createdAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}

const edit = (bulletId: string) => suggestion({ kind: 'edit', bulletId, parentId: null });
const add = (position: number) => suggestion({ kind: 'add', position });

// On screen: the two selected bullets first, then the unselected one.
const ROWS = ['b1', 'b2', 'b3'];
const SELECTED = ['b1', 'b2'];

test("an edit's card sits on its bullet's row", () => {
  const e = edit('b2');
  const placed = placeSuggestions(ROWS, SELECTED, [e]);
  assert.equal(placed.edits.get('b2'), e);
  assert.equal(placed.before.size, 0);
  assert.deepEqual(placed.after, []);
});

test('an add goes before the selected bullet at its position', () => {
  const first = add(0);
  const second = add(1);
  const placed = placeSuggestions(ROWS, SELECTED, [first, second]);
  assert.deepEqual(placed.before.get('b1'), [first]);
  assert.deepEqual(placed.before.get('b2'), [second]);
  assert.deepEqual(placed.after, []);
});

test('an add past the selected bullets goes last, after the unselected ones', () => {
  const end = add(2);
  const far = add(9);
  const placed = placeSuggestions(ROWS, SELECTED, [end, far]);
  assert.equal(placed.before.size, 0);
  assert.deepEqual(placed.after, [end, far]);
  // Nothing selected: every add is last.
  assert.equal(placeSuggestions(ROWS, [], [add(0)]).after.length, 1);
});

test('several adds at one position keep their creation order', () => {
  const a = add(1);
  const b = add(1);
  assert.deepEqual(placeSuggestions(ROWS, SELECTED, [a, b]).before.get('b2'), [a, b]);
});

test('an edit whose bullet has no row still gets a card, last', () => {
  const lost = edit('hidden');
  const far = add(5);
  const placed = placeSuggestions(ROWS, SELECTED, [lost, far]);
  assert.equal(placed.edits.size, 0);
  assert.deepEqual(placed.after, [lost, far]);
});

test('markup is a backslash and a letter; an escaped character is not', () => {
  assert.equal(hasLatexMarkup('Cut latency \\textbf{40\\%}'), true);
  assert.equal(hasLatexMarkup('See \\href{https://x.test}{the demo}'), true);
  assert.equal(hasLatexMarkup('Cut latency 40\\% and saved \\$2M \\& more'), false);
  assert.equal(hasLatexMarkup('Plain text'), false);
});

test('suggestions are filed under the parent whose list shows them', () => {
  const parents = [
    { id: 'exp', bullets: [{ id: 'b1' }, { id: 'b2' }] },
    { id: 'other', bullets: [{ id: 'o1' }] },
  ];
  const e = edit('o1');
  const a = suggestion({ kind: 'add', parentId: 'exp', position: 0 });
  const lost = edit('nowhere');
  const orphan = suggestion({ kind: 'add', parentId: 'gone', position: 0 });
  const filed = suggestionsByParent(parents, [e, a, lost, orphan]);
  assert.deepEqual([...filed.keys()].sort(), ['exp', 'other']);
  assert.deepEqual(filed.get('other'), [e]);
  assert.deepEqual(filed.get('exp'), [a]);
});
