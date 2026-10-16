/**
 * Applications against a real database. The interesting behaviour is not the
 * CRUD — it is the two resume references: one that keeps moving, one that is
 * frozen the moment something is sent (D-032).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { repinRefusal } from '../applications/review.ts';
import type { ApplicationStatus } from '../types.ts';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let createApplication: typeof import('./applications.ts').createApplication;
let pinResumePdf: typeof import('./applications.ts').pinResumePdf;
let findReadyApplicationPinning: typeof import('./applications.ts').findReadyApplicationPinning;
let recordReadyApplied: typeof import('./applications.ts').recordReadyApplied;
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
    findReadyApplicationPinning,
    getApplicationDetail,
    listApplications,
    pinResumePdf,
    recordApplied,
    recordReadyApplied,
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

test('entering applied stamps applied_at, and later moves never touch it', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  const created = await createApplication(userId, { company: `T-App ${fixtures.testTag()}` });
  try {
    const applied = await updateApplication(userId, created.id, { status: 'applied' });
    assert.ok(applied.appliedAt, 'applied_at must be set when the status reaches applied');

    const interviewing = await updateApplication(userId, created.id, { status: 'interviewing' });
    assert.equal(interviewing.appliedAt, applied.appliedAt);

    // Back to draft: the status is an opinion, the date sent is a fact.
    const backToDraft = await updateApplication(userId, created.id, { status: 'draft' });
    assert.equal(backToDraft.appliedAt, applied.appliedAt);
  } finally {
    await fixtures.deleteApplicationRow(created.id);
  }
});

test(
  'marking a ready application applied stamps applied_at for the first time',
  { skip },
  async () => {
    const userId = await fixtures.seedUserId();
    // Ready is a flow status: the API refuses to set it, so the row is written directly.
    const row = await fixtures.insertTestApplication(userId, fixtures.testTag(), {
      status: 'ready',
    });
    try {
      assert.equal(row.appliedAt, null, 'reaching ready must not count as sent');

      const applied = await recordApplied(userId, row.id, null);
      assert.equal(applied.status, 'applied');
      assert.ok(applied.appliedAt, 'leaving ready for applied is when it was sent');
    } finally {
      await fixtures.deleteApplicationRow(row.id);
    }
  },
);

test(
  'the agent fields come back on the wire, and are null when logged by hand',
  { skip },
  async () => {
    const userId = await fixtures.seedUserId();
    const tag = fixtures.testTag();
    const scored = await fixtures.insertTestApplication(userId, tag, {
      status: 'needs_review',
      fitScore: 4.3,
      jobDescription: `Build things at ${tag}.\nShip them.`,
      agentSummary: `Strong match for ${tag}.`,
    });
    const byHand = await createApplication(userId, { company: `T-App ${tag}` });

    try {
      const listed = await listApplications(userId, false);
      const listedScored = listed.find((a) => a.id === scored.id);
      // Strictly the number: postgres.js hands `numeric` back as a string, and
      // the schema's `mode: 'number'` is what turns it into one.
      assert.equal(listedScored?.fitScore, 4.3);
      assert.equal(listedScored?.status, 'needs_review');
      assert.equal(listed.find((a) => a.id === byHand.id)?.fitScore, null);

      const detail = await getApplicationDetail(userId, scored.id);
      assert.equal(detail?.fitScore, 4.3);
      assert.equal(detail?.jobDescription, `Build things at ${tag}.\nShip them.`);
      assert.equal(detail?.agentSummary, `Strong match for ${tag}.`);

      assert.equal(byHand.fitScore, null);
      assert.equal(byHand.jobDescription, null);
      assert.equal(byHand.agentSummary, null);
    } finally {
      await fixtures.deleteApplicationRow(scored.id);
      await fixtures.deleteApplicationRow(byHand.id);
    }
  },
);

test('a fit score above 5.0 is refused by the database (C13)', { skip }, async () => {
  const userId = await fixtures.seedUserId();
  let insertedId: string | null = null;
  try {
    await assert.rejects(
      async () => {
        // numeric(2,1) alone would store 5.1; only the CHECK stops it.
        const row = await fixtures.insertTestApplication(userId, fixtures.testTag(), {
          fitScore: 5.1,
        });
        insertedId = row.id;
      },
      (error: unknown) => {
        // drizzle wraps the driver's error; the constraint name is on the cause.
        const cause = (error as { cause?: { constraint_name?: string } }).cause;
        return cause?.constraint_name === 'ck_application_fit_score';
      },
    );
  } finally {
    if (insertedId) await fixtures.deleteApplicationRow(insertedId);
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
    assert.equal(blob?.applicationId, created.id);

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

// ---------------------------------------------------------------------------
// A Ready application's PDF is the one final approval pinned, and only the
// next final approval replaces it (C4, D-044).
// ---------------------------------------------------------------------------

/** A fresh account with a resume, two snapshots of it, and one application
 *  in `status` pinned to the first. */
async function pinned(status: ApplicationStatus) {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`repin-${tag}`);
  const resume = await fixtures.insertTestResume(user.id, tag);
  const snapshot = (filename: string) =>
    saveResumePdfSnapshot(resume.id, { filename, bytes: Buffer.from('%PDF'), tex: '' });
  const approvedPdf = await snapshot('approved.pdf');
  const newerPdf = await snapshot('newer.pdf');
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status,
    resumeId: resume.id,
    resumePdfId: approvedPdf.id,
    resumeApprovedAt: new Date(),
    approvedAt: status === 'ready' ? new Date() : null,
  });
  return {
    user,
    app,
    approvedPdf,
    newerPdf,
    async cleanup() {
      // The application first: its snapshot reference is `on delete restrict`.
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
    },
  };
}

function refusedAsReady(err: unknown): boolean {
  return err instanceof BadRequestError && err.message === repinRefusal('ready');
}

test(
  "a Ready application's approved PDF cannot be replaced, by saving or by sending",
  { skip },
  async () => {
    const s = await pinned('ready');
    try {
      await assert.rejects(() => pinResumePdf(s.user.id, s.app.id, s.newerPdf.id), refusedAsReady);
      await assert.rejects(() => recordApplied(s.user.id, s.app.id, s.newerPdf.id), refusedAsReady);

      const unchanged = await getApplicationDetail(s.user.id, s.app.id);
      assert.equal(unchanged?.status, 'ready');
      assert.equal(unchanged?.sentPdf?.filename, 'approved.pdf');
      assert.ok(unchanged?.approvedAt);

      // Sending it without a new PDF, which is what `POST /apply` does for one
      // that has a PDF pinned, still works, and keeps the approved one.
      const sent = await recordApplied(s.user.id, s.app.id, null);
      assert.equal(sent.status, 'applied');
      assert.equal(sent.sentPdf?.filename, 'approved.pdf');
    } finally {
      await s.cleanup();
    }
  },
);

test('in Needs review or once applied, a new PDF can still be pinned', { skip }, async () => {
  for (const status of ['needs_review', 'applied'] as const) {
    const s = await pinned(status);
    try {
      const saved = await pinResumePdf(s.user.id, s.app.id, s.newerPdf.id);
      assert.equal(saved.sentPdf?.filename, 'newer.pdf', status);
      assert.equal(saved.status, status, 'pinning leaves the status alone');

      const sent = await recordApplied(s.user.id, s.app.id, s.approvedPdf.id);
      assert.equal(sent.sentPdf?.filename, 'approved.pdf', status);
      assert.equal(sent.status, 'applied');
    } finally {
      await s.cleanup();
    }
  }
});

test("re-pinning another user's application is not found, not refused", { skip }, async () => {
  const s = await pinned('ready');
  const other = await fixtures.insertUser(`repin-other-${fixtures.testTag()}`);
  try {
    await assert.rejects(() => pinResumePdf(other.id, s.app.id, s.newerPdf.id), NotFoundError);
    await assert.rejects(() => recordApplied(other.id, s.app.id, s.newerPdf.id), NotFoundError);
    const unchanged = await getApplicationDetail(s.user.id, s.app.id);
    assert.equal(unchanged?.sentPdf?.filename, 'approved.pdf');
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Applying from the agent (D-050): `mark_applied` sends only a Ready
// application, and the files route finds a PDF's application only while it
// is Ready.
// ---------------------------------------------------------------------------

test('marking a Ready application applied keeps the PDF that was approved', { skip }, async () => {
  const s = await pinned('ready');
  try {
    const sent = await recordReadyApplied(s.user.id, s.app.id);
    assert.equal(sent?.status, 'applied');
    assert.ok(sent?.appliedAt, 'applied_at is stamped');
    assert.equal(sent?.sentPdf?.filename, 'approved.pdf');
    assert.ok(sent?.approvedAt, 'the approval stays as history');

    // Applied now, so a second call matches nothing and changes nothing.
    assert.equal(await recordReadyApplied(s.user.id, s.app.id), null);
    const again = await getApplicationDetail(s.user.id, s.app.id);
    assert.equal(again?.appliedAt, sent?.appliedAt);
  } finally {
    await s.cleanup();
  }
});

test('only a live Ready application is marked applied by the agent', { skip }, async () => {
  for (const status of ['draft', 'proposing', 'needs_review', 'rejected'] as const) {
    const s = await pinned(status);
    try {
      assert.equal(await recordReadyApplied(s.user.id, s.app.id), null, status);
      const unchanged = await getApplicationDetail(s.user.id, s.app.id);
      assert.equal(unchanged?.status, status);
      assert.equal(unchanged?.appliedAt, null, status);
    } finally {
      await s.cleanup();
    }
  }

  const archived = await pinned('ready');
  try {
    await updateApplication(archived.user.id, archived.app.id, { isArchived: true });
    assert.equal(await recordReadyApplied(archived.user.id, archived.app.id), null);
    assert.equal((await getApplicationDetail(archived.user.id, archived.app.id))?.status, 'ready');
  } finally {
    await archived.cleanup();
  }
});

test('a pinned PDF leads back to its application only while it is Ready', { skip }, async () => {
  const s = await pinned('ready');
  try {
    assert.equal(await findReadyApplicationPinning(s.user.id, s.approvedPdf.id), s.app.id);
    // A later snapshot of the same resume was never approved.
    assert.equal(await findReadyApplicationPinning(s.user.id, s.newerPdf.id), null);

    await updateApplication(s.user.id, s.app.id, { isArchived: true });
    assert.equal(await findReadyApplicationPinning(s.user.id, s.approvedPdf.id), null);
  } finally {
    await s.cleanup();
  }

  for (const status of ['needs_review', 'applied'] as const) {
    const other = await pinned(status);
    try {
      assert.equal(await findReadyApplicationPinning(other.user.id, other.approvedPdf.id), null);
    } finally {
      await other.cleanup();
    }
  }
});
