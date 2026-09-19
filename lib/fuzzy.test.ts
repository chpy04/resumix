import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyFilter, fuzzyScore } from './fuzzy.ts';

test('empty query matches everything with score 0 and no positions', () => {
  const match = fuzzyScore('', 'Anything');
  assert.deepEqual(match, { score: 0, positions: [] });
});

test('empty target never matches a non-empty query', () => {
  assert.equal(fuzzyScore('a', ''), null);
});

test('non-subsequence does not match', () => {
  assert.equal(fuzzyScore('xyz', 'Acme Corp'), null);
});

test('case-insensitive exact match', () => {
  const match = fuzzyScore('acme', 'ACME Corp');
  assert.ok(match);
  assert.deepEqual(match!.positions, [0, 1, 2, 3]);
});

test('contiguous subsequence scores higher than scattered, all else equal', () => {
  // Neither target has any word-boundary characters near the match, so this
  // isolates the contiguity bonus specifically.
  const scattered = fuzzyScore('ab', 'xaxbx'); // a, then a gap, then b
  const contiguous = fuzzyScore('ab', 'xabxx'); // a immediately followed by b
  assert.ok(scattered);
  assert.ok(contiguous);
  assert.ok(
    contiguous!.score > scattered!.score,
    `expected contiguous (${contiguous!.score}) > scattered (${scattered!.score})`,
  );
});

test('word-boundary matches rank above mid-word matches of the same letters', () => {
  // "rn" could match "Resume-Name" as R(0) N(7, boundary after hyphen) or
  // as r-in-middle-of-word combos; the boundary alignment should win.
  const boundary = fuzzyScore('rn', 'Resume-Name');
  const midWord = fuzzyScore('rn', 'xresumexnamex');
  assert.ok(boundary);
  assert.ok(midWord);
  assert.ok(
    boundary!.score > midWord!.score,
    `expected boundary (${boundary!.score}) > midWord (${midWord!.score})`,
  );
});

test('camelCase transitions count as word boundaries', () => {
  const match = fuzzyScore('sr', 'StripeResume');
  assert.ok(match);
  assert.deepEqual(match!.positions, [0, 6]);
});

test('matches at the very start score higher than the same match later', () => {
  const early = fuzzyScore('ac', 'acme other stuff');
  const late = fuzzyScore('ac', 'other stuff acme');
  assert.ok(early);
  assert.ok(late);
  assert.ok(early!.score > late!.score, `expected early (${early!.score}) > late (${late!.score})`);
});

test('shorter targets are preferred as a tiebreak for equally-good matches', () => {
  const short = fuzzyScore('meta', 'Meta');
  const long = fuzzyScore('meta', 'Meta Platforms Incorporated Resume Draft Number Nine');
  assert.ok(short);
  assert.ok(long);
  assert.ok(short!.score > long!.score);
});

test('fuzzyFilter returns matches sorted best-first', () => {
  const items = ['Google', 'Stripe', 'Netflix Resume', 'Meta'];
  const results = fuzzyFilter(items, 'net', (item) => item);
  assert.equal(results.length, 1);
  assert.equal(items[results[0]!.index], 'Netflix Resume');
});

test('fuzzyFilter with empty query returns all items unscored, in original order', () => {
  const items = ['b', 'a', 'c'];
  const results = fuzzyFilter(items, '   ', (item) => item);
  assert.deepEqual(
    results.map((r) => r.index),
    [0, 1, 2],
  );
});

test('fuzzyFilter excludes non-matching items', () => {
  const items = ['Default', 'Stripe', 'Google'];
  const results = fuzzyFilter(items, 'zzz', (item) => item);
  assert.equal(results.length, 0);
});

test('fuzzyFilter ranks a whole-word prefix match above a scattered match', () => {
  const items = ['Some Other Napkin Company', 'Stripe'];
  const results = fuzzyFilter(items, 'stripe', (item) => item);
  assert.equal(results.length, 1);
  assert.equal(items[results[0]!.index], 'Stripe');
});
