/**
 * The agent's files route against a real database: it serves exactly the
 * files in a live Ready application's packet, and every other file, whoever
 * owns it, is the same 404 (C5, D-050). The smoke proves the 401 and the
 * real route.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplyFileKind } from '../applications/apply-packet.ts';
import { buildResumeFilename } from '../filename.ts';

const skip = !process.env.DATABASE_URL;

let serveApplyFile: typeof import('./files.ts').serveApplyFile;
let addApplicationFile: typeof import('../queries/application-files.ts').addApplicationFile;
let updateApplicationFile: typeof import('../queries/application-files.ts').updateApplicationFile;
let getApplicationRow: typeof import('../queries/applications.ts').getApplicationRow;
let recordReadyApplied: typeof import('../queries/applications.ts').recordReadyApplied;
let updateApplication: typeof import('../queries/applications.ts').updateApplication;
let replaceSelections: typeof import('../queries/selections.ts').replaceSelections;
let saveResumePdfSnapshot: typeof import('../storage.ts').saveResumePdfSnapshot;
let fixtures: typeof import('../queries/test-fixtures.ts');

if (!skip) {
  ({ serveApplyFile } = await import('./files.ts'));
  ({ addApplicationFile, updateApplicationFile } = await import('../queries/application-files.ts'));
  ({ getApplicationRow, recordReadyApplied, updateApplication } = await import(
    '../queries/applications.ts'
  ));
  ({ replaceSelections } = await import('../queries/selections.ts'));
  ({ saveResumePdfSnapshot } = await import('../storage.ts'));
  fixtures = await import('../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

/** What `stubLatex` compiles every document to. */
const STUB_PDF = '%PDF-1.5\n';

/**
 * A Ready application with a letter, a take-home a file question picked, an
 * attachment nothing picked, and an older snapshot of its resume that was
 * never approved.
 */
async function setup() {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`files-${tag}`);
  const files: Record<string, string> = {};
  const ready = await fixtures.insertReadyApplication(user.id, tag, {
    async beforeApproval(applicationId) {
      const sample = await addApplicationFile(user.id, applicationId, {
        filename: 'take-home.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('%PDF-take-home'),
      });
      const notes = await addApplicationFile(user.id, applicationId, {
        filename: 'notes.html',
        contentType: 'text/html',
        bytes: Buffer.from('<p>notes</p>'),
      });
      await fixtures.insertTestQuestion(applicationId, {
        kind: 'file',
        prompt: 'Writing sample',
        answer: sample.id,
        approvedAt: new Date(),
      });
      files.sample = sample.id;
      files.notes = notes.id;
    },
  });
  const older = await saveResumePdfSnapshot(ready.resume.id, {
    filename: 'older.pdf',
    bytes: Buffer.from('%PDF-older'),
    tex: '',
  });
  const row = await getApplicationRow(user.id, ready.app.id);
  const letterFile = (await fixtures.listApplicationFileRows(ready.app.id)).find(
    (f) => f.id === row?.coverLetterPdfId,
  );
  assert.ok(row?.resumePdfId && letterFile && files.sample && files.notes);
  return {
    ...ready,
    user,
    resumePdfId: row.resumePdfId,
    letterFileId: letterFile.id,
    letterFilename: letterFile.filename,
    sampleId: files.sample,
    notesId: files.notes,
    olderPdfId: older.id,
  };
}

async function expectNotFound(userId: string, kind: ApplyFileKind, id: string, why: string) {
  const response = await serveApplyFile(userId, kind, id);
  assert.equal(response.status, 404, `${why}: expected 404, got ${response.status}`);
  assert.deepEqual(await response.json(), { error: `file ${id} not found` }, why);
}

test('each packet file is served with its bytes and download headers', { skip }, async () => {
  const s = await setup();
  try {
    const cases = [
      ['resume-pdf', s.resumePdfId, buildResumeFilename(s.company), STUB_PDF],
      ['application-file', s.letterFileId, s.letterFilename, STUB_PDF],
      ['application-file', s.sampleId, 'take-home.pdf', '%PDF-take-home'],
    ] as const;
    for (const [kind, id, filename, body] of cases) {
      const response = await serveApplyFile(s.user.id, kind, id);
      assert.equal(response.status, 200, `${kind} ${id}`);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(
        response.headers.get('content-disposition'),
        `attachment; filename="${filename}"`,
      );
      assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(body)));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(Buffer.from(await response.arrayBuffer()).toString('latin1'), body);
    }
  } finally {
    await s.cleanup();
  }
});

test(
  'a file the packet does not name is not found, though it is on the application',
  { skip },
  async () => {
    const s = await setup();
    try {
      await expectNotFound(s.user.id, 'application-file', s.notesId, 'an unpicked attachment');
      await expectNotFound(s.user.id, 'resume-pdf', s.olderPdfId, 'an unapproved snapshot');
      // An id served under the other kind is not that file.
      await expectNotFound(s.user.id, 'resume-pdf', s.letterFileId, 'a file id as a resume');
      await expectNotFound(s.user.id, 'application-file', s.resumePdfId, 'a resume id as a file');
      await expectNotFound(s.user.id, 'application-file', randomUUID(), 'an unknown id');
      await expectNotFound(s.user.id, 'resume-pdf', 'not-a-uuid', 'not a uuid');
    } finally {
      await s.cleanup();
    }
  },
);

test("another user's packet files are not found", { skip }, async () => {
  const s = await setup();
  const other = await fixtures.insertUser(`files-other-${fixtures.testTag()}`);
  try {
    await expectNotFound(other.id, 'resume-pdf', s.resumePdfId, 'their resume');
    await expectNotFound(other.id, 'application-file', s.letterFileId, 'their letter');
    await expectNotFound(other.id, 'application-file', s.sampleId, 'their attachment');
  } finally {
    await s.cleanup();
  }
});

test('nothing is served once the application is reopened, sent or archived', { skip }, async () => {
  const reopen = async (s: Awaited<ReturnType<typeof setup>>) => {
    // An edit to the resume's selection sends it back to review (C3).
    await replaceSelections(s.user.id, s.resume.id, { experiences: [] });
    assert.equal((await getApplicationRow(s.user.id, s.app.id))?.status, 'needs_review');
  };
  const send = async (s: Awaited<ReturnType<typeof setup>>) => {
    assert.ok(await recordReadyApplied(s.user.id, s.app.id));
  };
  const archive = async (s: Awaited<ReturnType<typeof setup>>) => {
    await updateApplication(s.user.id, s.app.id, { isArchived: true });
  };

  for (const [change, name] of [
    [reopen, 'reopened'],
    [send, 'applied'],
    [archive, 'archived'],
  ] as const) {
    const s = await setup();
    try {
      await change(s);
      await expectNotFound(s.user.id, 'resume-pdf', s.resumePdfId, `${name}: resume`);
      await expectNotFound(s.user.id, 'application-file', s.letterFileId, `${name}: letter`);
      await expectNotFound(s.user.id, 'application-file', s.sampleId, `${name}: attachment`);
    } finally {
      await s.cleanup();
    }
  }
});

test(
  'the pinned letter is served once archived, and an unpicked file is not',
  { skip },
  async () => {
    const s = await setup();
    try {
      // Archiving reopens nothing, and the pin is what was approved (D-011).
      await updateApplicationFile(s.user.id, s.letterFileId, { isArchived: true });
      assert.equal((await getApplicationRow(s.user.id, s.app.id))?.status, 'ready');
      const letter = await serveApplyFile(s.user.id, 'application-file', s.letterFileId);
      assert.equal(letter.status, 200);
      assert.equal(Buffer.from(await letter.arrayBuffer()).toString('latin1'), STUB_PDF);

      // An attachment nothing picked stays unservable, archived or not.
      await updateApplicationFile(s.user.id, s.notesId, { isArchived: true });
      await expectNotFound(s.user.id, 'application-file', s.notesId, 'an archived unpicked file');
    } finally {
      await s.cleanup();
    }
  },
);
