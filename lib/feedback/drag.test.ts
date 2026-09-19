import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstImageFile, isFileDrag } from './drag.ts';

/** Enough of a `DataTransfer` for `isFileDrag`, which only reads `types`. */
function transfer(types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

test('a drag carrying files is recognised from its types, not its files', () => {
  // The whole point: during dragover the file list is empty by design.
  assert.equal(isFileDrag(transfer(['Files'])), true);
  assert.equal(isFileDrag(transfer(['Files', 'text/uri-list'])), true);
});

test('a drag carrying anything else is not a file drag', () => {
  assert.equal(isFileDrag(transfer(['text/plain'])), false);
  assert.equal(isFileDrag(transfer([])), false);
  assert.equal(isFileDrag(null), false);
  assert.equal(isFileDrag(undefined), false);
});

test('the first image in a multi-file drop wins, not the first file', () => {
  const png = file('shot.png', 'image/png');
  assert.equal(firstImageFile([file('notes.txt', 'text/plain'), png]), png);
});

test('a drop with no image in it attaches nothing', () => {
  assert.equal(firstImageFile([file('notes.txt', 'text/plain')]), null);
  assert.equal(firstImageFile([]), null);
  assert.equal(firstImageFile(null), null);
  assert.equal(firstImageFile(undefined), null);
});

test('a dragged folder, which has no MIME type, is ignored', () => {
  assert.equal(firstImageFile([file('Screenshots', '')]), null);
});
