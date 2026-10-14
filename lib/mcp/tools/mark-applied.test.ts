/**
 * `mark_applied` against a real database: only a Ready application is
 * sent, and it keeps the PDFs final approval stored (C3, C4, D-050).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { buildResumeFilename } from '../../filename.ts';

const skip = !process.env.DATABASE_URL;

let markApplied: typeof import('./mark-applied.ts').markApplied;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ markApplied } = await import('./mark-applied.ts'));
  ({ getApplicationRow } = await import('../../queries/applications.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

function call(userId: string, applicationId: string) {
  return markApplied.call({ userId }, { application_id: applicationId });
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

test('a Ready application becomes applied, keeping what was approved', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`applied-${tag}`);
  const ready = await fixtures.insertReadyApplication(user.id, tag);
  try {
    const before = await getApplicationRow(user.id, ready.app.id);
    const filesBefore = await fixtures.listApplicationFileRows(ready.app.id);

    const result = await call(user.id, ready.app.id);
    assert.equal(result.isError, undefined, text(result));
    const answer = JSON.parse(text(result)) as { applied_at: string };

    const after = await getApplicationRow(user.id, ready.app.id);
    assert.equal(after?.status, 'applied');
    assert.ok(after?.appliedAt);
    assert.deepEqual(answer, {
      application_id: ready.app.id,
      status: 'applied',
      applied_at: after.appliedAt.toISOString(),
      resume_filename: buildResumeFilename(ready.company),
    });
    assert.equal(after.resumePdfId, before?.resumePdfId);
    assert.ok(after.approvedAt, 'the approval stays as history');
    assert.deepEqual(
      (await fixtures.listApplicationFileRows(ready.app.id)).map((f) => [f.id, f.isArchived]),
      filesBefore.map((f) => [f.id, f.isArchived]),
    );

    // Again: already sent, and nothing moves.
    const again = await call(user.id, ready.app.id);
    assert.equal(again.isError, true);
    assert.equal(text(again), 'This application is already applied; nothing to do.');
    assert.deepEqual((await getApplicationRow(user.id, ready.app.id))?.appliedAt, after.appliedAt);
  } finally {
    await ready.cleanup();
  }
});

test('any other status is refused, and applied_at is untouched', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`applied-st-${tag}`);
  for (const status of ['draft', 'proposing', 'needs_review'] as const) {
    const app = await fixtures.insertTestApplication(user.id, tag, { status });
    try {
      const result = await call(user.id, app.id);
      assert.equal(result.isError, true, status);
      assert.equal(
        text(result),
        `This application is ${status}, not Ready: it changed after the packet was fetched. ` +
          'Nothing was changed. If Chris already submitted, ask him to mark it applied on its ' +
          'page in Resumix.',
      );
      const row = await getApplicationRow(user.id, app.id);
      assert.deepEqual([row?.status, row?.appliedAt], [status, null]);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
    }
  }

  const sentAt = new Date('2026-09-01T10:00:00.000Z');
  for (const status of ['interviewing', 'offered', 'rejected'] as const) {
    const app = await fixtures.insertTestApplication(user.id, tag, { status, appliedAt: sentAt });
    try {
      const result = await call(user.id, app.id);
      assert.equal(result.isError, true, status);
      assert.equal(text(result), `This application is already ${status}; nothing to do.`);
      const row = await getApplicationRow(user.id, app.id);
      assert.deepEqual([row?.status, row?.appliedAt], [status, sentAt]);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
    }
  }
});

test('an unknown, archived or foreign application is not found', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`applied-nf-${tag}`);
  const bob = await fixtures.insertUser(`applied-bob-${tag}`);
  const bobs = await fixtures.insertReadyApplication(bob.id, `b-${tag}`);
  const archived = await fixtures.insertTestApplication(user.id, tag, {
    status: 'ready',
    isArchived: true,
  });
  try {
    for (const id of [randomUUID(), archived.id, bobs.app.id]) {
      const result = await call(user.id, id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
    assert.equal((await getApplicationRow(bob.id, bobs.app.id))?.status, 'ready');
    assert.equal((await getApplicationRow(user.id, archived.id))?.status, 'ready');
  } finally {
    await fixtures.deleteApplicationRow(archived.id);
    await bobs.cleanup();
  }
});
