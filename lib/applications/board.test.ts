import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closedApplications, groupByStatus, sortByRecency, statusForDrop } from './board.ts';
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
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('the board columns are the statuses that still want something', () => {
  const columns = groupByStatus([application('a', 'offered')]);
  assert.deepEqual(
    columns.map((column) => column.status),
    ['draft', 'interviewing', 'offered'],
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
