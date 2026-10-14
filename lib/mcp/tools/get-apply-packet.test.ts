/**
 * `get_apply_packet` against a real database, on applications made Ready
 * by `approveApplication` (`insertReadyApplication`), so the letter file it
 * finds is the one final approval really stores (C4, D-050).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { packetRefusal } from '../../applications/apply-packet.ts';
import { buildResumeFilename } from '../../filename.ts';

const skip = !process.env.DATABASE_URL;

let getApplyPacket: typeof import('./get-apply-packet.ts').getApplyPacket;
let addApplicationFile: typeof import('../../queries/application-files.ts').addApplicationFile;
let updateApplicationFile: typeof import('../../queries/application-files.ts').updateApplicationFile;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let updateApplication: typeof import('../../queries/applications.ts').updateApplication;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ getApplyPacket } = await import('./get-apply-packet.ts'));
  ({ addApplicationFile, updateApplicationFile } = await import(
    '../../queries/application-files.ts'
  ));
  ({ getApplicationRow, updateApplication } = await import('../../queries/applications.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

function call(userId: string, applicationId: string) {
  return getApplyPacket.call({ userId }, { application_id: applicationId });
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

const OFFICES = ['NYC', 'Boston', 'Remote'];

test(
  'a Ready application answers its posting, both files and every question',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`packet-${tag}`);
    const ids: Record<string, string> = {};
    const ready = await fixtures.insertReadyApplication(user.id, tag, {
      async beforeApproval(applicationId) {
        const sample = await addApplicationFile(user.id, applicationId, {
          filename: 'take-home.pdf',
          contentType: 'application/pdf',
          bytes: Buffer.from('%PDF-take-home'),
        });
        ids.sample = sample.id;
        const at = new Date();
        const add = (overrides: Parameters<typeof fixtures.insertTestQuestion>[1]) =>
          fixtures.insertTestQuestion(applicationId, overrides);
        ids.why = (
          await add({
            sortOrder: 0,
            prompt: 'Why us?',
            fieldRef: { page: 0, label: 'Why us?', selector: 'role=textbox[name="Why us?"]' },
            required: true,
            source: 'agent',
            proposedAnswer: 'Freight.',
            answer: 'Because freight.',
            approvedAt: at,
          })
        ).id;
        ids.office = (
          await add({
            sortOrder: 1,
            prompt: 'Which office?',
            kind: 'choice',
            options: OFFICES,
            fieldRef: { page: 1, label: 'Which office?', selector: null },
            answerMode: 'instruction',
            answer: 'Boston if listed, otherwise Remote',
            approvedAt: at,
          })
        ).id;
        ids.where = (
          await add({
            sortOrder: 2,
            prompt: 'Where could you work?',
            kind: 'multi',
            options: OFFICES,
            fieldRef: { page: 1, label: 'Where could you work?', selector: null },
            answer: JSON.stringify(['NYC', 'Remote']),
            approvedAt: at,
          })
        ).id;
        ids.referral = (
          await add({
            sortOrder: 3,
            prompt: 'Referral name',
            fieldRef: { page: 2, label: 'Referral name', selector: null },
          })
        ).id;
        ids.writing = (
          await add({
            sortOrder: 4,
            prompt: 'Writing sample',
            kind: 'file',
            fieldRef: { page: 2, label: 'Writing sample', selector: null },
            answer: sample.id,
            approvedAt: at,
          })
        ).id;
      },
    });
    try {
      const row = await getApplicationRow(user.id, ready.app.id);
      const letterFile = (await fixtures.listApplicationFileRows(ready.app.id)).find((f) =>
        f.filename.endsWith('_Cover_Letter.pdf'),
      );
      assert.ok(row?.resumePdfId && row.approvedAt && letterFile);

      const result = await call(user.id, ready.app.id);
      assert.equal(result.isError, undefined, text(result));
      const none = { answer_mode: null, answer: null, file: null };
      assert.deepEqual(JSON.parse(text(result)), {
        application_id: ready.app.id,
        status: 'ready',
        company: ready.company,
        role_title: 'Test Engineer',
        posting_url: '',
        approved_at: row.approvedAt.toISOString(),
        resume: {
          filename: buildResumeFilename(ready.company),
          url: `/api/mcp/files/resume-pdf/${row.resumePdfId}`,
        },
        cover_letter: {
          filename: letterFile.filename,
          url: `/api/mcp/files/application-file/${letterFile.id}`,
        },
        questions: [
          {
            question_id: ids.why,
            field_ref: { page: 0, label: 'Why us?', selector: 'role=textbox[name="Why us?"]' },
            prompt: 'Why us?',
            kind: 'text',
            options: null,
            required: true,
            is_eeo: false,
            approved: true,
            answer_mode: 'value',
            answer: 'Because freight.',
            file: null,
          },
          {
            question_id: ids.office,
            field_ref: { page: 1, label: 'Which office?', selector: null },
            prompt: 'Which office?',
            kind: 'choice',
            options: OFFICES,
            required: false,
            is_eeo: false,
            approved: true,
            answer_mode: 'instruction',
            answer: 'Boston if listed, otherwise Remote',
            file: null,
          },
          {
            question_id: ids.where,
            field_ref: { page: 1, label: 'Where could you work?', selector: null },
            prompt: 'Where could you work?',
            kind: 'multi',
            options: OFFICES,
            required: false,
            is_eeo: false,
            approved: true,
            answer_mode: 'value',
            answer: ['NYC', 'Remote'],
            file: null,
          },
          {
            question_id: ids.referral,
            field_ref: { page: 2, label: 'Referral name', selector: null },
            prompt: 'Referral name',
            kind: 'text',
            options: null,
            required: false,
            is_eeo: false,
            approved: false,
            ...none,
          },
          {
            question_id: ids.writing,
            field_ref: { page: 2, label: 'Writing sample', selector: null },
            prompt: 'Writing sample',
            kind: 'file',
            options: null,
            required: false,
            is_eeo: false,
            approved: true,
            answer_mode: 'value',
            answer: null,
            file: {
              filename: 'take-home.pdf',
              url: `/api/mcp/files/application-file/${ids.sample}`,
            },
          },
        ],
      });
    } finally {
      await ready.cleanup();
    }
  },
);

test('with no letter, cover_letter is null', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`packet-nl-${tag}`);
  const ready = await fixtures.insertReadyApplication(user.id, tag, { withLetter: false });
  try {
    const result = await call(user.id, ready.app.id);
    assert.equal(result.isError, undefined, text(result));
    const packet = JSON.parse(text(result)) as { cover_letter: unknown; questions: unknown[] };
    assert.equal(packet.cover_letter, null);
    assert.deepEqual(packet.questions, []);
  } finally {
    await ready.cleanup();
  }
});

test('an archived letter PDF is refused, and nothing changes', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`packet-al-${tag}`);
  const ready = await fixtures.insertReadyApplication(user.id, tag);
  try {
    const [letterFile] = await fixtures.listApplicationFileRows(ready.app.id);
    assert.ok(letterFile);
    await updateApplicationFile(user.id, letterFile.id, { isArchived: true });

    const result = await call(user.id, ready.app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      `This application is Ready, but its approved cover letter PDF (${letterFile.filename}) is ` +
        'missing or archived. Nothing was changed. Stop and tell Chris to approve it again.',
    );
    assert.equal((await getApplicationRow(user.id, ready.app.id))?.status, 'ready');
  } finally {
    await ready.cleanup();
  }
});

test('every other status is refused with what to do next', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`packet-st-${tag}`);
  for (const status of ['draft', 'proposing', 'needs_review', 'applied', 'rejected'] as const) {
    const app = await fixtures.insertTestApplication(user.id, tag, { status });
    try {
      const result = await call(user.id, app.id);
      assert.equal(result.isError, true, status);
      assert.equal(text(result), packetRefusal(status, app.id), status);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
    }
  }
});

test('an unknown, archived or foreign application is not found', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`packet-nf-${tag}`);
  const bob = await fixtures.insertUser(`packet-bob-${tag}`);
  const mine = await fixtures.insertReadyApplication(user.id, tag);
  const bobs = await fixtures.insertReadyApplication(bob.id, `b-${tag}`);
  try {
    await updateApplication(user.id, mine.app.id, { isArchived: true });
    for (const [caller, id] of [
      [user.id, randomUUID()],
      [user.id, mine.app.id],
      [user.id, bobs.app.id],
    ] as const) {
      const result = await call(caller, id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
  } finally {
    await mine.cleanup();
    await bobs.cleanup();
  }
});
