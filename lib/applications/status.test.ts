import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION_STATUSES, hasBeenSent, nextAppliedAt, statusLabel } from './status.ts';

test('the vocabulary is the five statuses, in board order', () => {
  assert.deepEqual(
    [...APPLICATION_STATUSES],
    ['draft', 'applied', 'interviewing', 'offered', 'rejected'],
  );
});

test('every status has a label', () => {
  for (const status of APPLICATION_STATUSES) {
    assert.ok(statusLabel(status).length > 0, `${status} needs a label`);
  }
});

test('hasBeenSent is true for everything but draft', () => {
  assert.equal(hasBeenSent('draft'), false);
  assert.equal(hasBeenSent('applied'), true);
  assert.equal(hasBeenSent('interviewing'), true);
  assert.equal(hasBeenSent('offered'), true);
  assert.equal(hasBeenSent('rejected'), true);
});

const now = new Date('2026-03-01T12:00:00.000Z');
const earlier = new Date('2026-01-15T09:30:00.000Z');

test('nextAppliedAt: leaving draft for the first time stamps the date', () => {
  assert.equal(nextAppliedAt(null, 'applied', now), now);
});

test('nextAppliedAt: staying in draft leaves it unset', () => {
  assert.equal(nextAppliedAt(null, 'draft', now), null);
});

test('nextAppliedAt: a status that skips straight past applied still stamps it', () => {
  // Logging an application after the fact, straight into "interviewing".
  assert.equal(nextAppliedAt(null, 'interviewing', now), now);
});

test('nextAppliedAt: an existing date is never moved', () => {
  assert.equal(nextAppliedAt(earlier, 'offered', now), earlier);
  assert.equal(nextAppliedAt(earlier, 'rejected', now), earlier);
});

test('nextAppliedAt: going back to draft keeps the date it was sent', () => {
  // The date something was sent is a fact; the status is an opinion.
  assert.equal(nextAppliedAt(earlier, 'draft', now), earlier);
});
