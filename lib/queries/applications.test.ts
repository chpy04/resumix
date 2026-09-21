/**
 * Applications against a real database. The interesting behaviour is not the
 * CRUD — it is the two resume references: one that keeps moving, one that is
 * frozen the moment something is sent (D-032).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let createApplication: typeof import('./applications.ts').createApplication;
let pinResumePdf: typeof import('./applications.ts').pinResumePdf;
let getApplicationDetail: typeof import('./applications.ts').getApplicationDetail;
let listApplications: typeof import('./applications.ts').listApplications;
let recordApplied: typeof import('./applications.ts').recordApplied;
let updateApplication: typeof import('./applications.ts').updateApplication;
let addApplicationFile: typeof import('./application-files.ts').addApplicationFile;
let getApplicationFileBlob: typeof import('./application-files.ts').getApplicationFileBlob;
let listApplicationFiles: typeof import('./application-files.ts').listApplicationFiles;
let updateApplicationFile: typeof import('./application-files.ts').updateApplicationFile;
let deleteResume: typeof import('./resumes.ts').deleteResume;
let getResumeDetail: typeof import('./resumes.ts').getResumeDetail;
let getSelections: typeof import('./selections.ts').getSelections;
let saveResumePdfSnapshot: typeof import('../storage.ts').saveResumePdfSnapshot;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError, NotFoundError } = await import('./errors.ts'));
  ({
    createApplication,
    getApplicationDetail,
    listApplications,
    pinResumePdf,
    recordApplied,
    updateApplication,
  } = await import('./applications.ts'));
  ({ addApplicationFile, getApplicationFileBlob, listApplicationFiles, updateApplicationFile } =
    await import('./application-files.ts'));
  ({ deleteResume, getResumeDetail } = await import('./resumes.ts'));
  ({ getSelections } = await import('./selections.ts'));
  ({ saveResumePdfSnapshot } = await import('../storage.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

test('a new application starts as an empty draft', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });
  try {
    assert.equal(created.status, 'draft');
    assert.equal(created.appliedAt, null);
    assert.equal(created.sentPdf, null);
    assert.equal(created.resumeId, null);
    assert.equal(created.notes, '');
    assert.deepEqual(created.files, []);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test(
  'a new application clones a resume of its own, named after the company',
  { skip },
  async () => {
    const userId = await fixtures.seedUserId();
    const tag = fixtures.testTag();
    const source = await fixtures.insertTestResume(userId, tag);
    const company = `T-App Clone Co ${tag}`;

    const created = await createApplication(userId, { company, createResumeFrom: source.id });
    try {
      assert.ok(created.resumeId, 'the application must be linked to the resume it created');
      assert.notEqual(created.resumeId, source.id, 'it must be a copy, not the source itself');

      const detail = await getResumeDetail(userId, created.resumeId!);
      assert.equal(detail?.resume.name, company);
      // Cloned, not blank: the selections come from the resume it started from.
      const sourceSelections = await getSelections(source.id);
      assert.deepEqual(
        (await getSelections(created.resumeId!)).experiences,
        sourceSelections.experiences,
      );
    } finally {
      await fixtures.deleteApplicationRow(created.id);
      if (created.resumeId) await fixtures.deleteResumeRow(created.resumeId);
      await fixtures.deleteResumeRow(source.id);
    }
  },
);

test('creating against a resume id that does not exist is a 400', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  await assert.rejects(
    () =>
      createApplication(userId, {
        company: 'T-App Nowhere',
        resumeId: '00000000-0000-4000-8000-000000000000',
      }),
    BadRequestError,
  );
});

test('leaving draft stamps applied_at, and later moves never touch it', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });
  try {
    const applied = await updateApplication(userId, created.id, { status: 'applied' });
    assert.ok(applied.appliedAt, 'applied_at must be set when the status leaves draft');

    const interviewing = await updateApplication(userId, created.id, { status: 'interviewing' });
    assert.equal(interviewing.appliedAt, applied.appliedAt);

    // Back to draft: the status is an opinion, the date sent is a fact.
    const backToDraft = await updateApplication(userId, created.id, { status: 'draft' });
    assert.equal(backToDraft.appliedAt, applied.appliedAt);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test('archived applications are off the board unless asked for', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });
  try {
    await updateApplication(userId, created.id, { isArchived: true });

    const visible = await listApplications(userId, false);
    assert.ok(!visible.some((a) => a.id === created.id));

    const all = await listApplications(userId, true);
    assert.ok(all.some((a) => a.id === created.id));
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test(
  'the sent PDF stays pinned to the bytes that went out, while the resume link moves on',
  { skip },
  async () => {
    const userId = await fixtures.seedUserId();
    const tag = fixtures.testTag();
    const resumeRow = await fixtures.insertTestResume(userId, tag);
    const application = await createApplication(userId, {
      company: `T-App ${tag}`,
      resumeId: resumeRow.id,
    });

    try {
      const sent = await saveResumePdfSnapshot(resumeRow.id, {
        filename: `T_App_${tag}_v1.pdf`,
        bytes: Buffer.from('%PDF-1.4 first'),
        tex: '\\documentclass{article}\\begin{document}first\\end{document}',
      });
      const applied = await recordApplied(userId, application.id, sent.id);
      assert.equal(applied.status, 'applied');
      assert.equal(applied.sentPdf?.filename, `T_App_${tag}_v1.pdf`);
      assert.equal(applied.resumeId, resumeRow.id, 'the live resume link survives being sent');

      // The resume keeps being edited and saved afterwards — which is the
      // whole point of the editor — and none of that reaches the application.
      await saveResumePdfSnapshot(resumeRow.id, {
        filename: `T_App_${tag}_v2.pdf`,
        bytes: Buffer.from('%PDF-1.4 second'),
        tex: '\\documentclass{article}\\begin{document}second\\end{document}',
      });

      const reread = await getApplicationDetail(userId, application.id);
      assert.equal(reread?.sentPdf?.filename, `T_App_${tag}_v1.pdf`);
    } finally {
      await fixtures.deleteApplicationRow(application.id);
      await fixtures.deleteResumeRow(resumeRow.id);
    }
  },
);

test('a resume an application was sent with cannot be deleted', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const tag = fixtures.testTag();
  const resumeRow = await fixtures.insertTestResume(userId, tag);
  const application = await createApplication(userId, {
    company: `T-App ${tag}`,
    resumeId: resumeRow.id,
  });

  try {
    const sent = await saveResumePdfSnapshot(resumeRow.id, {
      filename: `T_App_${tag}.pdf`,
      bytes: Buffer.from('%PDF-1.4 sent'),
      tex: '\\documentclass{article}\\begin{document}sent\\end{document}',
    });
    await recordApplied(userId, application.id, sent.id);

    // `resume_pdf` cascades from `resume`, so allowing this would destroy the
    // only record of what was actually sent.
    await assert.rejects(() => deleteResume(userId, resumeRow.id), BadRequestError);
  } finally {
    await fixtures.deleteApplicationRow(application.id);
    await fixtures.deleteResumeRow(resumeRow.id);
  }
});

test('saving a resume to an application pins it without declaring it sent', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const tag = fixtures.testTag();
  const resumeRow = await fixtures.insertTestResume(userId, tag);
  const created = await createApplication(userId, {
    company: `T-App ${tag}`,
    resumeId: resumeRow.id,
  });

  try {
    const saved = await saveResumePdfSnapshot(resumeRow.id, {
      filename: `T_App_${tag}_draft.pdf`,
      bytes: Buffer.from('%PDF-1.4 draft'),
      tex: '\\documentclass{article}\\begin{document}draft\\end{document}',
    });

    const pinned = await pinResumePdf(userId, created.id, saved.id);
    assert.equal(pinned.sentPdf?.filename, `T_App_${tag}_draft.pdf`);
    // Still a draft: saving a PDF and declaring it sent are separate acts.
    assert.equal(pinned.status, 'draft');
    assert.equal(pinned.appliedAt, null);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
    await fixtures.deleteResumeRow(resumeRow.id);
  }
});

test('an application with no resume can still be marked applied', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });
  try {
    const applied = await recordApplied(userId, created.id, null);
    assert.equal(applied.status, 'applied');
    assert.ok(applied.appliedAt);
    assert.equal(applied.sentPdf, null);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test('files attach, come back out byte for byte, and archive', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });

  try {
    const bytes = Buffer.from('Dear hiring manager,\n');
    const stored = await addApplicationFile(userId, created.id, {
      filename: 'cover-letter.txt',
      contentType: 'text/plain',
      bytes,
    });
    assert.equal(stored.byteSize, bytes.byteLength);
    assert.equal(stored.isArchived, false);

    const blob = await getApplicationFileBlob(userId, stored.id);
    assert.equal(blob?.bytes.toString('utf8'), 'Dear hiring manager,\n');

    const detail = await getApplicationDetail(userId, created.id);
    assert.deepEqual(
      detail?.files.map((file) => file.id),
      [stored.id],
    );

    const archived = await updateApplicationFile(userId, stored.id, { isArchived: true });
    assert.equal(archived.isArchived, true);

    // Archived, not gone (D-011).
    const files = await listApplicationFiles(userId, created.id);
    assert.equal(files.length, 1);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test('updating an application that does not exist is a 404', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  await assert.rejects(
    () =>
      updateApplication(userId, '00000000-0000-4000-8000-000000000000', { company: 'Nobody Inc' }),
    NotFoundError,
  );
});
