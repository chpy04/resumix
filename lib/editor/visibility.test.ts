import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSelectedOrder, isVisible, orderForDisplay, visibleItems } from './visibility.ts';

test('isVisible: a non-archived item is always visible', () => {
  assert.equal(isVisible({ id: 'a', isArchived: false }, new Set(), false), true);
});

test('isVisible: an archived, unselected item is hidden by default', () => {
  assert.equal(isVisible({ id: 'a', isArchived: true }, new Set(), false), false);
});

test('isVisible: an archived item is shown when "show archived" is on', () => {
  assert.equal(isVisible({ id: 'a', isArchived: true }, new Set(), true), true);
});

test('isVisible: D-011 — an archived item that is selected on this resume is always shown', () => {
  assert.equal(isVisible({ id: 'a', isArchived: true }, new Set(['a']), false), true);
});

test('visibleItems filters a list per the same rule, keeping order', () => {
  const items = [
    { id: 'a', isArchived: false },
    { id: 'b', isArchived: true },
    { id: 'c', isArchived: true },
  ];
  // 'b' is archived but selected -> stays visible even with showArchived=false.
  const result = visibleItems(items, ['b'], false);
  assert.deepEqual(
    result.map((i) => i.id),
    ['a', 'b'],
  );
});

test('visibleItems shows everything when showArchived is true', () => {
  const items = [
    { id: 'a', isArchived: false },
    { id: 'b', isArchived: true },
  ];
  assert.deepEqual(
    visibleItems(items, [], true).map((i) => i.id),
    ['a', 'b'],
  );
});

test('orderForDisplay puts selected items first, in resume order, then the rest in library order', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const result = orderForDisplay(items, ['c', 'a']);
  assert.deepEqual(
    result.map((i) => i.id),
    ['c', 'a', 'b', 'd'],
  );
});

test('orderForDisplay ignores a selected id that no longer exists in items', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const result = orderForDisplay(items, ['ghost', 'b']);
  assert.deepEqual(
    result.map((i) => i.id),
    ['b', 'a'],
  );
});

test('orderForDisplay never duplicates an id that is both selected and appears again in items', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const result = orderForDisplay(items, ['a', 'a']);
  assert.deepEqual(
    result.map((i) => i.id),
    ['a', 'b'],
  );
});

test('extractSelectedOrder keeps only selected ids, in the given relative order', () => {
  const result = extractSelectedOrder(['x', 'a', 'y', 'b'], ['a', 'b']);
  assert.deepEqual(result, ['a', 'b']);
});

test('extractSelectedOrder returns an empty array when nothing in the list is selected', () => {
  assert.deepEqual(extractSelectedOrder(['x', 'y'], ['a']), []);
});
