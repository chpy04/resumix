/**
 * The reopen rule against a real database (C3, C6, D-044): which writes
 * unapprove an application in review, and which deliberately do not. Plus
 * `approveSection`'s refusals, which share the same rule.
 *
 * Each test starts from an application whose resume and letter are both
 * approved, so a write that reopens shows up as a cleared stamp.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../types.ts';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let approveSection: typeof import('./applications.ts').approveSection;
let attachCoverLetter: typeof import('./applications.ts').attachCoverLetter;
let getApplicationRow: typeof import('./applications.ts').getApplicationRow;
let updateApplication: typeof import('./applications.ts').updateApplication;
let createCoverLetter: typeof import('./cover-letters.ts').createCoverLetter;
let updateCoverLetter: typeof import('./cover-letters.ts').updateCoverLetter;
let updateExperienceBullet: typeof import('./experience-bullets.ts').updateExperienceBullet;
let updateTemplate: typeof import('./templates.ts').updateTemplate;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError, NotFoundError } = await import('./errors.ts'));
  ({ approveSection, attachCoverLetter, getApplicationRow, updateApplication } = await import(
    './applications.ts'
  ));
  ({ createCoverLetter, updateCoverLetter } = await import('./cover-letters.ts'));
  ({ updateExperienceBullet } = await import('./experience-bullets.ts'));
  ({ updateTemplate } = await import('./templates.ts'));
  ({ replaceSelections } = await import('./selections.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const STAMP = new Date('2026-10-12T10:00:00.000Z');

/** A fresh account with one application in `status`, its resume and its
 *  letter both approved — and, when `ready`, finally approved too. */
async function approved(status: ApplicationStatus = 'ready') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`appr-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const bullet = await fixtures.insertExperienceBullet(exp.id, 'Shipped the thing');
  const resume = await fixtures.insertTestResume(user.id, tag);
  // Before the application exists, so this write reopens nothing.
  await replaceSelections(user.id, resume.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [bullet.id] },
  });
  const letter = await createCoverLetter(user.id, `Letter ${tag}`);
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status,
    resumeId: resume.id,
    coverLetterId: letter.id,
    resumeApprovedAt: STAMP,
    coverLetterApprovedAt: STAMP,
    approvedAt: status === 'needs_review' ? null : STAMP,
  });

  return {
    user,
    exp,
    bullet,
    resume,
    letter,
    app,
    read: () => getApplicationRow(user.id, app.id),
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
      await fixtures.deleteCoverLetterRow(letter.id);
    },
  };
}

test(
  "a selection write reopens a ready application's resume and keeps its letter",
  { skip },
  async () => {
    const s = await approved('ready');
    try {
      await replaceSelections(s.user.id, s.resume.id, { experienceBullets: { [s.exp.id]: [] } });
      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.resumeApprovedAt, null);
      assert.equal(row?.approvedAt, null);
      assert.deepEqual(row?.coverLetterApprovedAt, STAMP);
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'a write that restores the same selection still reopens: there is no diffing',
  { skip },
  async () => {
    const s = await approved('ready');
    try {
      await replaceSelections(s.user.id, s.resume.id, { experiences: [s.exp.id] });
      assert.equal((await s.read())?.status, 'needs_review');
    } finally {
      await s.cleanup();
    }
  },
);

test(
  "a letter's text reopens its letter and keeps the resume; a rename does not",
  { skip },
  async () => {
    const s = await approved('ready');
    try {
      await updateCoverLetter(s.user.id, s.letter.id, { name: 'Renamed' });
      assert.equal((await s.read())?.status, 'ready', 'a rename changes nothing that is sent');

      await updateCoverLetter(s.user.id, s.letter.id, { content: '\\documentclass{letter}' });
      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.coverLetterApprovedAt, null);
      assert.equal(row?.approvedAt, null);
      assert.deepEqual(row?.resumeApprovedAt, STAMP);
    } finally {
      await s.cleanup();
    }
  },
);

test('in Needs review a write clears only its own section', { skip }, async () => {
  const s = await approved('needs_review');
  try {
    await replaceSelections(s.user.id, s.resume.id, { experiences: [] });
    const row = await s.read();
    assert.equal(row?.status, 'needs_review');
    assert.equal(row?.resumeApprovedAt, null);
    assert.deepEqual(row?.coverLetterApprovedAt, STAMP);
  } finally {
    await s.cleanup();
  }
});

test('editing a selected bullet in the library reopens nothing (C6)', { skip }, async () => {
  const s = await approved('ready');
  try {
    await updateExperienceBullet(s.user.id, s.bullet.id, {
      content: 'Shipped it, \\textbf{twice}',
    });
    const row = await s.read();
    assert.equal(row?.status, 'ready');
    assert.deepEqual(row?.resumeApprovedAt, STAMP);
    assert.deepEqual(row?.approvedAt, STAMP);
  } finally {
    await s.cleanup();
  }
});

test('editing the template reopens nothing (C6)', { skip }, async () => {
  const s = await approved('ready');
  try {
    await updateTemplate(s.user.id, s.resume.templateId, { content: '<<EXPERIENCE>>' });
    assert.equal((await s.read())?.status, 'ready');
  } finally {
    await s.cleanup();
  }
});

test('a sent application is history: no write reopens it', { skip }, async () => {
  const s = await approved('applied');
  try {
    await replaceSelections(s.user.id, s.resume.id, { experiences: [] });
    await updateCoverLetter(s.user.id, s.letter.id, { content: 'changed' });
    const row = await s.read();
    assert.equal(row?.status, 'applied');
    assert.deepEqual(row?.resumeApprovedAt, STAMP);
    assert.deepEqual(row?.coverLetterApprovedAt, STAMP);
    assert.deepEqual(row?.approvedAt, STAMP);
  } finally {
    await s.cleanup();
  }
});

test('relinking or unlinking the resume reopens the resume', { skip }, async () => {
  const s = await approved('ready');
  const other = await fixtures.insertTestResume(s.user.id, 'other');
  try {
    await updateApplication(s.user.id, s.app.id, { resumeId: other.id });
    let row = await s.read();
    assert.equal(row?.status, 'needs_review');
    assert.equal(row?.resumeApprovedAt, null);
    assert.deepEqual(row?.coverLetterApprovedAt, STAMP);

    // Re-approve, then unlink: still a change to what it sends.
    await approveSection(s.user.id, s.app.id, 'resume');
    await updateApplication(s.user.id, s.app.id, { resumeId: null });
    row = await s.read();
    assert.equal(row?.resumeApprovedAt, null);
  } finally {
    await fixtures.deleteApplicationRow(s.app.id);
    await fixtures.deleteResumeRow(other.id);
    await s.cleanup();
  }
});

test('a PATCH that leaves the links as they are reopens nothing', { skip }, async () => {
  const s = await approved('ready');
  try {
    await updateApplication(s.user.id, s.app.id, {
      notes: 'Called the recruiter.',
      resumeId: s.resume.id,
      coverLetterId: s.letter.id,
    });
    assert.equal((await s.read())?.status, 'ready');
  } finally {
    await s.cleanup();
  }
});

test(
  'relinking the letter reopens the letter; a status in the same PATCH wins',
  { skip },
  async () => {
    const s = await approved('ready');
    const other = await createCoverLetter(s.user.id, 'Other letter');
    try {
      await updateApplication(s.user.id, s.app.id, { coverLetterId: other.id });
      let row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.coverLetterApprovedAt, null);
      assert.deepEqual(row?.resumeApprovedAt, STAMP);

      // Sent and relinked at once: it has been sent, so it is history.
      await updateApplication(s.user.id, s.app.id, {
        status: 'applied',
        coverLetterId: s.letter.id,
      });
      row = await s.read();
      assert.equal(row?.status, 'applied');
    } finally {
      await fixtures.deleteApplicationRow(s.app.id);
      await fixtures.deleteCoverLetterRow(other.id);
      await s.cleanup();
    }
  },
);

test('adding a letter to a ready application sends it back to review', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`appr-add-${tag}`);
  const resume = await fixtures.insertTestResume(user.id, tag);
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status: 'ready',
    resumeId: resume.id,
    resumeApprovedAt: STAMP,
    approvedAt: STAMP,
  });
  let letterId: string | null = null;
  try {
    const attached = await attachCoverLetter(user.id, app.id);
    letterId = attached.coverLetterId;
    assert.ok(letterId);
    // A new letter is a new section to approve.
    assert.equal(attached.status, 'needs_review');
    assert.equal(attached.approvedAt, null);
    assert.equal(attached.coverLetterApprovedAt, null);
    assert.equal(attached.resumeApprovedAt, STAMP.toISOString(), 'the resume keeps its approval');
  } finally {
    await fixtures.deleteApplicationRow(app.id);
    await fixtures.deleteResumeRow(resume.id);
    if (letterId) await fixtures.deleteCoverLetterRow(letterId);
  }
});

test('approveSection stamps a section in Needs review', { skip }, async () => {
  const s = await approved('needs_review');
  try {
    await updateCoverLetter(s.user.id, s.letter.id, { content: 'changed' });
    assert.equal((await s.read())?.coverLetterApprovedAt, null);

    const detail = await approveSection(s.user.id, s.app.id, 'coverLetter');
    assert.ok(detail.coverLetterApprovedAt);
    assert.equal(detail.status, 'needs_review', 'a section approval is not the final one');
  } finally {
    await s.cleanup();
  }
});

test(
  'approveSection refuses outside Needs review, and a section that is not there',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`appr-no-${tag}`);
    const ready = await fixtures.insertTestApplication(user.id, `${tag}-ready`, {
      status: 'ready',
    });
    const noLetter = await fixtures.insertTestApplication(user.id, `${tag}-nl`, {
      status: 'needs_review',
    });
    try {
      await assert.rejects(
        () => approveSection(user.id, ready.id, 'resume'),
        (err: Error) =>
          err instanceof BadRequestError &&
          err.message === 'Only an application in Needs review can be approved; this one is Ready.',
      );
      await assert.rejects(
        () => approveSection(user.id, noLetter.id, 'coverLetter'),
        (err: Error) =>
          err instanceof BadRequestError &&
          err.message === 'This application has no cover letter to approve.',
      );
      await assert.rejects(
        () => approveSection(user.id, noLetter.id, 'resume'),
        (err: Error) =>
          err instanceof BadRequestError &&
          err.message === 'This application has no resume to approve.',
      );
      await assert.rejects(
        () => approveSection(user.id, '00000000-0000-4000-8000-000000000000', 'resume'),
        NotFoundError,
      );

      const untouched = await getApplicationRow(user.id, noLetter.id);
      assert.equal(untouched?.resumeApprovedAt, null);
      assert.equal(untouched?.coverLetterApprovedAt, null);
    } finally {
      await fixtures.deleteApplicationRow(ready.id);
      await fixtures.deleteApplicationRow(noLetter.id);
    }
  },
);
