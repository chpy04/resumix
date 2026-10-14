/**
 * Final approval against a real database, with the sidecar stubbed at
 * `fetch` (`stubLatex`): CI's test job has none, and which document fails
 * to compile is the thing under test (C4, D-044).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let approveApplication: typeof import('./application-approval.ts').approveApplication;
let BadRequestError: typeof import('./queries/errors.ts').BadRequestError;
let approveSection: typeof import('./queries/applications.ts').approveSection;
let getApplicationRow: typeof import('./queries/applications.ts').getApplicationRow;
let getApplicationDetail: typeof import('./queries/applications.ts').getApplicationDetail;
let recordFinalApproval: typeof import('./queries/applications.ts').recordFinalApproval;
let createCoverLetter: typeof import('./queries/cover-letters.ts').createCoverLetter;
let updateCoverLetter: typeof import('./queries/cover-letters.ts').updateCoverLetter;
let replaceSelections: typeof import('./queries/selections.ts').replaceSelections;
let buildCoverLetterFilename: typeof import('./filename.ts').buildCoverLetterFilename;
let buildResumeFilename: typeof import('./filename.ts').buildResumeFilename;
let fixtures: typeof import('./queries/test-fixtures.ts');

if (!skip) {
  ({ approveApplication } = await import('./application-approval.ts'));
  ({ BadRequestError } = await import('./queries/errors.ts'));
  ({ approveSection, getApplicationDetail, getApplicationRow, recordFinalApproval } = await import(
    './queries/applications.ts'
  ));
  ({ createCoverLetter, updateCoverLetter } = await import('./queries/cover-letters.ts'));
  ({ replaceSelections } = await import('./queries/selections.ts'));
  ({ buildCoverLetterFilename, buildResumeFilename } = await import('./filename.ts'));
  fixtures = await import('./queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const STAMP = new Date('2026-10-12T10:00:00.000Z');
const LETTER_MARKER = '% approval-test letter';

/** Tells the letter's `.tex` from the resume's by a comment only the letter has. */
function isLetter(tex: string): boolean {
  return tex.includes(LETTER_MARKER);
}

/** An application in Needs review with both sections approved, unless
 *  `withLetter` is false, in which case it has no letter at all. */
async function approvable(withLetter = true) {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`final-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const bullet = await fixtures.insertExperienceBullet(exp.id, 'Built the pipeline');
  const resume = await fixtures.insertTestResume(user.id, tag);
  await replaceSelections(user.id, resume.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [bullet.id] },
  });
  const company = `Google ${tag}`;
  const letter = withLetter ? await createCoverLetter(user.id, company) : null;
  if (letter) {
    await updateCoverLetter(user.id, letter.id, {
      content: `\\documentclass{letter}\n${LETTER_MARKER}\n\\begin{document}Hi.\\end{document}`,
    });
  }
  const app = await fixtures.insertTestApplication(user.id, tag, {
    company,
    status: 'needs_review',
    resumeId: resume.id,
    coverLetterId: letter?.id ?? null,
    resumeApprovedAt: STAMP,
    coverLetterApprovedAt: letter ? STAMP : null,
  });

  return {
    user,
    company,
    resume,
    letter,
    app,
    read: () => getApplicationRow(user.id, app.id),
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
      if (letter) await fixtures.deleteCoverLetterRow(letter.id);
    },
  };
}

test(
  'approval pins a resume snapshot, stores the letter PDF, and makes it ready',
  { skip },
  async () => {
    const s = await approvable();
    const latex = fixtures.stubLatex(() => 1);
    try {
      const result = await approveApplication(s.user.id, s.app.id);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(latex.sent.length, 2, 'the resume and the letter were compiled');

      const { application } = result;
      assert.equal(application.status, 'ready');
      assert.ok(application.approvedAt);
      assert.equal(application.sentPdf?.filename, buildResumeFilename(s.company));

      const snapshots = await fixtures.listResumePdfIds(s.resume.id);
      assert.equal(snapshots.length, 1);
      assert.equal((await s.read())?.resumePdfId, snapshots[0]);

      const files = await fixtures.listApplicationFileRows(s.app.id);
      assert.equal(files.length, 1);
      assert.equal(files[0]?.filename, buildCoverLetterFilename(s.company));
      assert.match(files[0]?.filename ?? '', /_Cover_Letter\.pdf$/);
      assert.equal(files[0]?.contentType, 'application/pdf');
      assert.equal(files[0]?.bytes.toString('latin1'), '%PDF-1.5\n');
      assert.deepEqual(
        application.files.map((f) => f.filename),
        [buildCoverLetterFilename(s.company)],
      );
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test(
  'a letter with a body is approved as its shell with the body filled in',
  { skip },
  async () => {
    const s = await approvable();
    // Editing the letter reopens it (D-044), so it is approved again after.
    await updateCoverLetter(s.user.id, s.letter!.id, {
      content: `\\documentclass{letter}\n${LETTER_MARKER}\n\\begin{document}\n%%BODY%%\n\\end{document}`,
      body: 'Dear Team,\n\nR&D at 100%.',
    });
    await approveSection(s.user.id, s.app.id, 'coverLetter');
    const latex = fixtures.stubLatex(() => 1);
    try {
      const result = await approveApplication(s.user.id, s.app.id);
      assert.ok(result.ok, JSON.stringify(result));
      const letterTex = latex.sent.filter(isLetter);
      assert.deepEqual(letterTex, [
        `\\documentclass{letter}\n${LETTER_MARKER}\n\\begin{document}\n` +
          'Dear Team,\n\nR\\&D at 100\\%.\n\\end{document}',
      ]);
      assert.equal((await fixtures.listApplicationFileRows(s.app.id)).length, 1);
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('the PDF names the page shows come from the server, prefix and all', { skip }, async () => {
  const s = await approvable();
  const previous = process.env.PDF_NAME_PREFIX;
  process.env.PDF_NAME_PREFIX = 'Server_Prefix';
  const latex = fixtures.stubLatex(() => 1);
  try {
    const before = await getApplicationDetail(s.user.id, s.app.id);
    const expected = {
      resume: buildResumeFilename(s.company),
      coverLetter: buildCoverLetterFilename(s.company),
    };
    assert.match(expected.resume, /^Server_Prefix_/);
    assert.deepEqual(before?.pdfFilenames, expected);

    // And they are the names approval stores the two PDFs under.
    const result = await approveApplication(s.user.id, s.app.id);
    assert.ok(result.ok);
    assert.equal(result.application.sentPdf?.filename, expected.resume);
    assert.deepEqual(
      result.application.files.map((f) => f.filename),
      [expected.coverLetter],
    );
  } finally {
    latex.restore();
    if (previous === undefined) delete process.env.PDF_NAME_PREFIX;
    else process.env.PDF_NAME_PREFIX = previous;
    await s.cleanup();
  }
});

test('with no letter, approval needs only the resume and stores no file', { skip }, async () => {
  const s = await approvable(false);
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await approveApplication(s.user.id, s.app.id);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.application.status, 'ready');
    assert.equal(latex.sent.length, 1);
    assert.deepEqual(await fixtures.listApplicationFileRows(s.app.id), []);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an unapproved section is refused before anything compiles', { skip }, async () => {
  const s = await approvable();
  await updateCoverLetter(s.user.id, s.letter!.id, { content: `${LETTER_MARKER} changed` });
  const latex = fixtures.stubLatex(() => 1);
  try {
    await assert.rejects(
      () => approveApplication(s.user.id, s.app.id),
      (err: Error) =>
        err instanceof BadRequestError && err.message === 'Approve the cover letter first.',
    );
    assert.equal(latex.sent.length, 0);
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'a pending bullet suggestion refuses approval before anything compiles',
  { skip },
  async () => {
    // No letter, so the pending suggestion is the only thing in the way.
    const s = await approvable(false);
    const latex = fixtures.stubLatex(() => 1);
    try {
      await fixtures.insertBulletSuggestion(s.app.id, {
        kind: 'add',
        parentId: (await fixtures.insertExperience(s.user.id, 'sugg')).id,
        position: 0,
      });
      await assert.rejects(
        () => approveApplication(s.user.id, s.app.id),
        (err: Error) =>
          err instanceof BadRequestError &&
          err.message === 'Apply or reject the bullet suggestion first.',
      );
      assert.equal(latex.sent.length, 0);

      // The transaction's own guard refuses one that arrives after the gate.
      await assert.rejects(
        () =>
          recordFinalApproval(s.user.id, s.app.id, {
            resumeId: s.resume.id,
            snapshot: { filename: 'r.pdf', bytes: Buffer.from('%PDF'), tex: '' },
            letter: null,
          }),
        BadRequestError,
      );
      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.approvedAt, null);
      assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), []);
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('a letter that does not compile writes nothing at all', { skip }, async () => {
  const s = await approvable();
  const latex = fixtures.stubLatex((tex) => (isLetter(tex) ? 'error' : 1));
  try {
    const result = await approveApplication(s.user.id, s.app.id);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.deepEqual(result.errors, [`Cover letter: ${fixtures.STUB_LATEX_ERROR}`]);

    // The resume compiled, and still nothing of it was kept.
    assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), []);
    assert.deepEqual(await fixtures.listApplicationFileRows(s.app.id), []);
    const row = await s.read();
    assert.equal(row?.status, 'needs_review');
    assert.equal(row?.approvedAt, null);
    assert.equal(row?.resumePdfId, null);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a resume that does not compile is named as the resume', { skip }, async () => {
  const s = await approvable();
  const latex = fixtures.stubLatex((tex) => (isLetter(tex) ? 1 : 'error'));
  try {
    const result = await approveApplication(s.user.id, s.app.id);
    assert.ok(!result.ok);
    assert.deepEqual(result.errors, [`Resume: ${fixtures.STUB_LATEX_ERROR}`]);
    assert.equal(latex.sent.length, 1, 'the letter is not compiled once the resume has failed');
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an unreachable sidecar is a failure, and writes nothing', { skip }, async () => {
  const s = await approvable();
  const latex = fixtures.stubLatex((tex) => (isLetter(tex) ? 'down' : 1));
  try {
    const result = await approveApplication(s.user.id, s.app.id);
    assert.ok(!result.ok);
    assert.match(result.errors[0] ?? '', /^Cover letter: Could not reach the latex service/);
    assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), []);
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'approving again archives the previous letter file and pins a new snapshot',
  { skip },
  async () => {
    const s = await approvable();
    const latex = fixtures.stubLatex(() => 1);
    try {
      const first = await approveApplication(s.user.id, s.app.id);
      assert.ok(first.ok);

      // The letter changes after approval, which reopens it; approve it again.
      await updateCoverLetter(s.user.id, s.letter!.id, { content: `${LETTER_MARKER} v2` });
      assert.equal((await s.read())?.status, 'needs_review');
      await approveSection(s.user.id, s.app.id, 'coverLetter');
      const second = await approveApplication(s.user.id, s.app.id);
      assert.ok(second.ok);

      const files = await fixtures.listApplicationFileRows(s.app.id);
      assert.equal(files.length, 2, 'nothing is deleted (D-011)');
      assert.deepEqual(
        files.map((f) => f.isArchived),
        [true, false],
      );
      assert.equal(
        second.application.files.filter((f) => !f.isArchived).length,
        1,
        'one approved letter',
      );

      const snapshots = await fixtures.listResumePdfIds(s.resume.id);
      assert.equal(snapshots.length, 2);
      assert.equal((await s.read())?.resumePdfId, snapshots[0], 'the newest snapshot is pinned');
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('an edit that lands during approval rolls the whole approval back', { skip }, async () => {
  const s = await approvable(false);
  try {
    // What the transaction finds if the resume changed after the compile:
    // the edit has already cleared the resume's approval.
    await replaceSelections(s.user.id, s.resume.id, { experiences: [] });
    await assert.rejects(
      () =>
        recordFinalApproval(s.user.id, s.app.id, {
          resumeId: s.resume.id,
          snapshot: { filename: 'x.pdf', bytes: Buffer.from('%PDF'), tex: '' },
          letter: null,
        }),
      (err: Error) =>
        err instanceof BadRequestError &&
        err.message === 'This application changed while it was being approved; review it again.',
    );
    assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), [], 'the snapshot rolled back');
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Questions (D-047): only the required ones gate, and an answer edit that
// races the approval wins.
// ---------------------------------------------------------------------------

/** What `recordFinalApproval` is handed once both documents compiled. */
function compiled(s: Awaited<ReturnType<typeof approvable>>) {
  return {
    resumeId: s.resume.id,
    snapshot: { filename: 'x.pdf', bytes: Buffer.from('%PDF'), tex: '' },
    letter: {
      coverLetterId: s.letter!.id,
      filename: 'x_Cover_Letter.pdf',
      bytes: Buffer.from('%PDF'),
    },
  };
}

test('an open required question refuses approval before anything compiles', { skip }, async () => {
  const s = await approvable();
  await fixtures.insertTestQuestion(s.app.id, { required: true, answer: 'Draft.' });
  const latex = fixtures.stubLatex(() => 1);
  try {
    await assert.rejects(
      () => approveApplication(s.user.id, s.app.id),
      (err: Error) =>
        err instanceof BadRequestError &&
        err.message === 'Approve the 1 required question still open in step 3.',
    );
    assert.equal(latex.sent.length, 0);
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an optional question left open does not hold up approval', { skip }, async () => {
  const s = await approvable();
  await fixtures.insertTestQuestion(s.app.id, {
    required: true,
    answer: 'Yes.',
    approvedAt: STAMP,
  });
  await fixtures.insertTestQuestion(s.app.id, { required: false });
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await approveApplication(s.user.id, s.app.id);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.application.status, 'ready');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'recordFinalApproval refuses while a required question is open, writing nothing',
  { skip },
  async () => {
    const s = await approvable();
    await fixtures.insertTestQuestion(s.app.id, { required: true });
    try {
      await assert.rejects(
        () => recordFinalApproval(s.user.id, s.app.id, compiled(s)),
        (err: Error) =>
          err instanceof BadRequestError &&
          err.message === 'This application changed while it was being approved; review it again.',
      );
      assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), []);
      assert.deepEqual(await fixtures.listApplicationFileRows(s.app.id), []);
      assert.equal((await s.read())?.status, 'needs_review');
    } finally {
      await s.cleanup();
    }
  },
);

test('an answer edit in flight makes approval wait for it, then refuse', { skip }, async () => {
  const s = await approvable();
  const q = await fixtures.insertTestQuestion(s.app.id, {
    required: true,
    answer: 'Yes.',
    approvedAt: STAMP,
  });
  try {
    // The edit holds the application's lock and has unapproved the question,
    // uncommitted. Approval starts while it is held.
    const edit = await fixtures.holdAnswerWrite(s.app.id, q.id);
    const approval = recordFinalApproval(s.user.id, s.app.id, compiled(s));
    await edit.waitForWaiter();
    await edit.commit();

    await assert.rejects(
      () => approval,
      (err: Error) =>
        err instanceof BadRequestError &&
        err.message === 'This application changed while it was being approved; review it again.',
    );
    assert.deepEqual(await fixtures.listResumePdfIds(s.resume.id), []);
    assert.equal((await s.read())?.status, 'needs_review');
  } finally {
    await s.cleanup();
  }
});
