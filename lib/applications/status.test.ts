import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_STATUSES,
  FLOW_STATUSES,
  hasBeenSent,
  isFlowStatus,
  MANUAL_STATUSES,
  nextAppliedAt,
  statusLabel,
} from './status.ts';

test('the vocabulary is the eight statuses, in pipeline order', () => {
  assert.deepEqual(
    [...APPLICATION_STATUSES],
    [
      'draft',
      'proposing',
      'needs_review',
      'ready',
      'applied',
      'interviewing',
      'offered',
      'rejected',
    ],
  );
});

test('flow and manual statuses split the vocabulary with nothing left over', () => {
  const both = [...FLOW_STATUSES, ...MANUAL_STATUSES];
  assert.equal(new Set(both).size, both.length, 'no status may be both');
  assert.deepEqual([...both].sort(), [...APPLICATION_STATUSES].sort());
});

test('isFlowStatus is true for exactly the three the review flow owns', () => {
  assert.deepEqual(APPLICATION_STATUSES.filter(isFlowStatus), [
    'proposing',
    'needs_review',
    'ready',
  ]);
});

test('every status has a label', () => {
  for (const status of APPLICATION_STATUSES) {
    assert.ok(statusLabel(status).length > 0, `${status} needs a label`);
  }
  assert.equal(statusLabel('needs_review'), 'Needs review');
});

test('hasBeenSent is false for draft and for every flow status', () => {
  assert.equal(hasBeenSent('draft'), false);
  assert.equal(hasBeenSent('proposing'), false);
  assert.equal(hasBeenSent('needs_review'), false);
  assert.equal(hasBeenSent('ready'), false);
});

test('hasBeenSent is true for applied and everything after it', () => {
  assert.equal(hasBeenSent('applied'), true);
  assert.equal(hasBeenSent('interviewing'), true);
  assert.equal(hasBeenSent('offered'), true);
  assert.equal(hasBeenSent('rejected'), true);
});

const now = new Date('2026-03-01T12:00:00.000Z');
const earlier = new Date('2026-01-15T09:30:00.000Z');

test('nextAppliedAt: entering applied for the first time stamps the date', () => {
  assert.equal(nextAppliedAt(null, 'applied', now), now);
});

test('nextAppliedAt: staying in draft leaves it unset', () => {
  assert.equal(nextAppliedAt(null, 'draft', now), null);
});

test('nextAppliedAt: entering a flow status never stamps it', () => {
  // The agent proposing, or a human reviewing, is not the application being sent.
  assert.equal(nextAppliedAt(null, 'proposing', now), null);
  assert.equal(nextAppliedAt(null, 'needs_review', now), null);
  assert.equal(nextAppliedAt(null, 'ready', now), null);
});

test('nextAppliedAt: leaving ready or needs_review for applied or rejected stamps it', () => {
  // The previous status is not an input: what matters is where it lands.
  assert.equal(nextAppliedAt(null, 'applied', now), now);
  assert.equal(nextAppliedAt(null, 'rejected', now), now);
});

test('nextAppliedAt: a status that skips straight past applied still stamps it', () => {
  // Logging an application after the fact, straight from draft into "interviewing".
  assert.equal(nextAppliedAt(null, 'interviewing', now), now);
});

test('nextAppliedAt: an existing date is never moved', () => {
  assert.equal(nextAppliedAt(earlier, 'offered', now), earlier);
  assert.equal(nextAppliedAt(earlier, 'rejected', now), earlier);
  assert.equal(nextAppliedAt(earlier, 'ready', now), earlier);
});

test('nextAppliedAt: going back to draft keeps the date it was sent', () => {
  // The date something was sent is a fact; the status is an opinion.
  assert.equal(nextAppliedAt(earlier, 'draft', now), earlier);
});
