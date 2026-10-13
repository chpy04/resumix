/**
 * `set_cover_letter_body` against a real database, with the sidecar stubbed
 * at `fetch` (`stubLatex`): CI's test job has none, and the page count is
 * part of the answer (D-046).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let setCoverLetterBody: typeof import('./set-cover-letter-body.ts').setCoverLetterBody;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let createCoverLetter: typeof import('../../queries/cover-letters.ts').createCoverLetter;
let getCoverLetter: typeof import('../../queries/cover-letters.ts').getCoverLetter;
let getDefaultCoverLetter: typeof import('../../queries/cover-letters.ts').getDefaultCoverLetter;
let listCoverLetters: typeof import('../../queries/cover-letters.ts').listCoverLetters;
let updateCoverLetter: typeof import('../../queries/cover-letters.ts').updateCoverLetter;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ setCoverLetterBody } = await import('./set-cover-letter-body.ts'));
  ({ getApplicationRow } = await import('../../queries/applications.ts'));
  ({
    createCoverLetter,
    getCoverLetter,
    getDefaultCoverLetter,
    listCoverLetters,
    updateCoverLetter,
  } = await import('../../queries/cover-letters.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const TEXT = 'Dear Team,\n\nI build R&D tools at 100%.\n\nBest,\nChris';
const TEX_BODY = 'Dear Team,\n\nI build R\\&D tools at 100\\%.\n\nBest,\\newline\nChris';
const STAMP = new Date('2026-10-12T10:00:00.000Z');

/** A fresh account, so its Default is the built-in shell, and one
 *  application in `status`, with a letter of its own unless told not to. */
async function setup(
  status: ApplicationStatus = 'proposing',
  withLetter = true,
  approvals: { resumeApprovedAt?: Date; coverLetterApprovedAt?: Date; approvedAt?: Date } = {},
) {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`body-${tag}`);
  const letter = withLetter ? await createCoverLetter(user.id, `Letter ${tag}`) : null;
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status,
    coverLetterId: letter?.id ?? null,
    ...approvals,
  });
  return {
    user,
    letter,
    app,
    read: () => getApplicationRow(user.id, app.id),
    letters: async () => (await listCoverLetters(user.id, true)).length,
    async cleanup() {
      const row = await getApplicationRow(user.id, app.id);
      await fixtures.deleteApplicationRow(app.id);
      // The letter the tool attached, or the one the setup made.
      if (row?.coverLetterId && row.coverLetterId !== letter?.id) {
        await fixtures.deleteCoverLetterRow(row.coverLetterId);
      }
      if (letter) await fixtures.deleteCoverLetterRow(letter.id);
    },
  };
}

function call(userId: string, applicationId: string, text = TEXT) {
  return setCoverLetterBody.call({ userId }, { application_id: applicationId, text });
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

test(
  'with no letter, it copies Default onto the application and writes into it',
  { skip },
  async () => {
    const s = await setup('proposing', false);
    const latex = fixtures.stubLatex(() => 1);
    try {
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, undefined, text(result));
      assert.deepEqual(JSON.parse(text(result)), { ok: true, pages: 1 });

      const row = await s.read();
      assert.ok(row?.coverLetterId, 'a letter is linked');
      const letter = await getCoverLetter(s.user.id, row.coverLetterId);
      const fallback = await getDefaultCoverLetter(s.user.id);
      assert.notEqual(letter?.id, fallback?.id);
      assert.equal(letter?.name, s.app.company);
      assert.equal(letter?.content, fallback?.content, 'the shell is Default, verbatim');
      assert.equal(letter?.body, TEXT, 'stored as typed');
      assert.equal(fallback?.body, null, 'Default itself is untouched');

      // What compiled is Default's shell with the text escaped into it.
      assert.equal(latex.sent.length, 1);
      assert.ok(latex.sent[0]?.includes(`\n${TEX_BODY}\n`), latex.sent[0]);
      assert.ok(!latex.sent[0]?.includes('%%BODY%%'));
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('a second call replaces the text in the same letter', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    await call(s.user.id, s.app.id);
    const result = await call(s.user.id, s.app.id, 'Hello again.');
    assert.equal(result.isError, undefined, text(result));
    assert.equal((await s.read())?.coverLetterId, s.letter?.id);
    assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, 'Hello again.');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a letter over one page is ok: false, and still saved', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 2);
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, undefined, text(result));
    assert.deepEqual(JSON.parse(text(result)), { ok: false, pages: 2 });
    assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, TEXT);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'editing a ready application sends it back to review, unapproving only the letter',
  { skip },
  async () => {
    const s = await setup('ready', true, {
      resumeApprovedAt: STAMP,
      coverLetterApprovedAt: STAMP,
      approvedAt: STAMP,
    });
    const latex = fixtures.stubLatex(() => 1);
    try {
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, undefined, text(result));
      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.coverLetterApprovedAt, null);
      assert.equal(row?.approvedAt, null);
      assert.deepEqual(row?.resumeApprovedAt, STAMP);
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test(
  'a letter that does not compile is saved, and the error says what to try',
  { skip },
  async () => {
    const s = await setup();
    const latex = fixtures.stubLatex(() => 'error');
    try {
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `The text was saved, but the letter does not compile: ${fixtures.STUB_LATEX_ERROR}. ` +
          'Remove any emoji or non-Latin characters and call again; if it still fails, stop and ' +
          'tell Chris.',
      );
      assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, TEXT);
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('an unreachable sidecar is saved, and says to call again', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 'down');
  try {
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, true);
    assert.match(
      text(result),
      /^The text was saved, but Resumix could not compile it \(Could not reach the latex service.*\)\. Call again with the same text in a minute; if it fails again, stop and tell Chris\.$/,
    );
    assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, TEXT);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Refusals. Each writes nothing and creates no letter, and compiles nothing.
// ---------------------------------------------------------------------------

test('a sent application is refused', { skip }, async () => {
  const latex = fixtures.stubLatex(() => 1);
  try {
    for (const status of ['applied', 'interviewing', 'offered', 'rejected'] as const) {
      for (const withLetter of [true, false]) {
        const s = await setup(status, withLetter);
        try {
          const before = await s.letters();
          const result = await call(s.user.id, s.app.id);
          assert.equal(result.isError, true, status);
          assert.equal(
            text(result),
            `This application is ${status}: it has been sent, so its cover letter is no longer ` +
              'drafted here. Nothing was written. Leave it as it is.',
          );
          assert.equal(await s.letters(), before);
          assert.equal((await s.read())?.coverLetterId, s.letter?.id ?? null);
          if (s.letter) assert.equal((await getCoverLetter(s.user.id, s.letter.id))?.body, null);
        } finally {
          await s.cleanup();
        }
      }
    }
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
  }
});

test('an application linked to the Default letter is refused', { skip }, async () => {
  const s = await setup('proposing', false);
  const fallback = await getDefaultCoverLetter(s.user.id);
  assert.ok(fallback);
  const app = await fixtures.insertTestApplication(s.user.id, 'default', {
    status: 'proposing',
    coverLetterId: fallback.id,
  });
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await call(s.user.id, app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      'This application is linked to the Default cover letter, which every new letter is ' +
        'copied from. Nothing was written; ask Chris to give it its own.',
    );
    assert.equal((await getCoverLetter(s.user.id, fallback.id))?.body, null);
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await fixtures.deleteApplicationRow(app.id);
    await s.cleanup();
  }
});

test('with no letter and no marker in Default, nothing is created', { skip }, async () => {
  const s = await setup('proposing', false);
  const fallback = await getDefaultCoverLetter(s.user.id);
  assert.ok(fallback);
  await updateCoverLetter(s.user.id, fallback.id, { content: '\\documentclass{article}' });
  const latex = fixtures.stubLatex(() => 1);
  try {
    const before = await s.letters();
    const result = await call(s.user.id, s.app.id);
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      "Chris's Default cover letter has no line holding only %%BODY%% (or more than one), so " +
        'a new letter would have nowhere to put the text. Nothing was written. Stop and tell ' +
        'Chris to put one in his Default letter where the text should go, then call again.',
    );
    assert.equal(await s.letters(), before, 'no letter was copied');
    assert.equal((await s.read())?.coverLetterId, null);
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a linked letter with no single marker is refused, naming it', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    for (const content of ['\\documentclass{article}', '%%BODY%%\n%%BODY%%']) {
      await updateCoverLetter(s.user.id, s.letter!.id, { content });
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `This application's cover letter (${s.letter!.name}) has no line holding only ` +
          '%%BODY%% (or more than one), so the text would have nowhere to go. Nothing was ' +
          'written. Stop and tell Chris to put one in that letter, and in his Default letter, ' +
          'where the text should go, then call again.',
      );
      assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, null);
    }
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an unknown, archived or foreign application is not found', { skip }, async () => {
  const s = await setup();
  const archived = await fixtures.insertTestApplication(s.user.id, 'archived', {
    status: 'proposing',
    coverLetterId: s.letter!.id,
    isArchived: true,
  });
  const bob = await fixtures.insertUser(`body-bob-${fixtures.testTag()}`);
  const bobs = await fixtures.insertTestApplication(bob.id, 'bob', { status: 'proposing' });
  const latex = fixtures.stubLatex(() => 1);
  try {
    for (const id of [randomUUID(), archived.id, bobs.id]) {
      const result = await call(s.user.id, id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
    assert.equal((await getApplicationRow(bob.id, bobs.id))?.coverLetterId, null);
    assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, null);
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await fixtures.deleteApplicationRow(archived.id);
    await fixtures.deleteApplicationRow(bobs.id);
    await s.cleanup();
  }
});

test('blank text is an argument error', { skip }, async () => {
  const s = await setup();
  try {
    const result = await call(s.user.id, s.app.id, ' \n\t ');
    assert.equal(result.isError, true);
    assert.match(text(result), /^Invalid arguments: text: /);
    assert.equal((await getCoverLetter(s.user.id, s.letter!.id))?.body, null);
  } finally {
    await s.cleanup();
  }
});
