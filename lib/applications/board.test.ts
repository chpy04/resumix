import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsDrop,
  closedApplications,
  groupByStatus,
  sortByFit,
  sortByRecency,
  statusForDrop,
} from './board.ts';
import { APPLICATION_STATUSES, FLOW_STATUSES } from './status.ts';
import type { ApplicationStatus, ApplicationSummary } from '../types.ts';

function application(
  id: string,
  status: ApplicationStatus,
  overrides: Partial<ApplicationSummary> = {},
): ApplicationSummary {
  return {
    id,
    company: `Company ${id}`,
    roleTitle: '',
    postingUrl: '',
    status,
    appliedAt: null,
    resumeId: null,
    sentPdf: null,
    coverLetterId: null,
    fitScore: null,
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('the board columns are the statuses that still want something, in pipeline order', () => {
  const columns = groupByStatus([application('a', 'offered')]);
  assert.deepEqual(
    columns.map((column) => column.status),
    ['draft', 'proposing', 'needs_review', 'ready', 'interviewing', 'offered'],
  );
});

test('Needs review is sorted by fit, best first, with unscored cards last', () => {
  const columns = groupByStatus([
    application('unscored', 'needs_review', { createdAt: '2026-09-01T00:00:00.000Z' }),
    application('ok', 'needs_review', { fitScore: 3.9 }),
    application('best', 'needs_review', { fitScore: 4.3 }),
  ]);
  const needsReview = columns.find((column) => column.status === 'needs_review');
  assert.deepEqual(
    needsReview?.applications.map((a) => a.id),
    ['best', 'ok', 'unscored'],
  );
});

test('sortByFit breaks a tie on recency, then on id (D-030)', () => {
  const sorted = sortByFit([
    application('older', 'needs_review', {
      fitScore: 4,
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    application('a', 'needs_review', { fitScore: 4, createdAt: '2026-05-01T00:00:00.000Z' }),
    application('b', 'needs_review', { fitScore: 4, createdAt: '2026-05-01T00:00:00.000Z' }),
    application('none-old', 'needs_review', { createdAt: '2026-01-01T00:00:00.000Z' }),
    application('none-new', 'needs_review', { createdAt: '2026-06-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['b', 'a', 'older', 'none-new', 'none-old'],
  );
});

test('the other columns ignore fit and stay sorted by recency', () => {
  const columns = groupByStatus([
    application('old-good', 'ready', { fitScore: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
    application('new-poor', 'ready', { fitScore: 1, createdAt: '2026-05-01T00:00:00.000Z' }),
  ]);
  const ready = columns.find((column) => column.status === 'ready');
  assert.deepEqual(
    ready?.applications.map((a) => a.id),
    ['new-poor', 'old-good'],
  );
});

test('applied and rejected applications are off the board entirely', () => {
  const columns = groupByStatus([
    application('sent', 'applied'),
    application('no', 'rejected'),
    application('a', 'draft'),
  ]);
  const ids = columns.flatMap((column) => column.applications.map((a) => a.id));
  assert.deepEqual(ids, ['a']);
});

test('closedApplications collects both exits, most recent first', () => {
  const rows = closedApplications([
    application('older', 'applied', { appliedAt: '2026-01-01T00:00:00.000Z' }),
    application('draft', 'draft'),
    application('newer', 'rejected', { appliedAt: '2026-06-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    rows.map((a) => a.id),
    ['newer', 'older'],
  );
});

test('statusForDrop returns the target status of a real move', () => {
  assert.equal(statusForDrop('draft', 'interviewing'), 'interviewing');
  assert.equal(statusForDrop('draft', 'applied'), 'applied');
  assert.equal(statusForDrop('offered', 'rejected'), 'rejected');
});

test('statusForDrop ignores a drop back where the card started', () => {
  assert.equal(statusForDrop('draft', 'draft'), null);
});

test('statusForDrop ignores anything that is not a status', () => {
  assert.equal(statusForDrop('draft', 'board'), null);
  assert.equal(statusForDrop('draft', ''), null);
});

test('statusForDrop never moves a card into a flow column, from anywhere', () => {
  // Only the review flow sets these (C3); a drop on one changes nothing.
  for (const from of APPLICATION_STATUSES) {
    for (const target of FLOW_STATUSES) {
      assert.equal(statusForDrop(from, target), null, `${from} -> ${target}`);
    }
  }
});

test('statusForDrop lets a card leave a flow column for a manual one', () => {
  assert.equal(statusForDrop('ready', 'applied'), 'applied');
  assert.equal(statusForDrop('ready', 'rejected'), 'rejected');
  assert.equal(statusForDrop('needs_review', 'rejected'), 'rejected');
  assert.equal(statusForDrop('proposing', 'draft'), 'draft');
});

test('acceptsDrop is false for exactly the flow columns', () => {
  assert.deepEqual(
    APPLICATION_STATUSES.filter((status) => !acceptsDrop(status)),
    ['proposing', 'needs_review', 'ready'],
  );
});

test('groupByStatus keeps empty columns — an empty Interviewing is information', () => {
  const columns = groupByStatus([application('a', 'draft')]);
  const interviewing = columns.find((column) => column.status === 'interviewing');
  assert.deepEqual(interviewing?.applications, []);
});

test('groupByStatus files each application under its own status', () => {
  const columns = groupByStatus([
    application('a', 'draft'),
    application('b', 'interviewing'),
    application('c', 'draft'),
  ]);
  const byStatus = new Map(columns.map((column) => [column.status, column.applications]));
  assert.deepEqual(
    byStatus
      .get('draft')
      ?.map((a) => a.id)
      .sort(),
    ['a', 'c'],
  );
  assert.deepEqual(
    byStatus.get('interviewing')?.map((a) => a.id),
    ['b'],
  );
});

test('sortByRecency puts the most recently sent first', () => {
  const sorted = sortByRecency([
    application('old', 'applied', { appliedAt: '2026-01-01T00:00:00.000Z' }),
    application('new', 'applied', { appliedAt: '2026-05-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['new', 'old'],
  );
});

test('sortByRecency falls back to when a draft was created', () => {
  const sorted = sortByRecency([
    application('first', 'draft', { createdAt: '2026-01-01T00:00:00.000Z' }),
    application('second', 'draft', { createdAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['second', 'first'],
  );
});

test('sortByRecency breaks a tie on id, so the order never flickers (D-030)', () => {
  const sameInstant = { appliedAt: '2026-04-01T00:00:00.000Z' };
  const sorted = sortByRecency([
    application('a', 'applied', sameInstant),
    application('b', 'applied', sameInstant),
  ]);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['b', 'a'],
  );
});

test('sortByRecency does not mutate its input', () => {
  const input = [
    application('a', 'applied', { appliedAt: '2026-01-01T00:00:00.000Z' }),
    application('b', 'applied', { appliedAt: '2026-05-01T00:00:00.000Z' }),
  ];
  sortByRecency(input);
  assert.deepEqual(
    input.map((a) => a.id),
    ['a', 'b'],
  );
});
