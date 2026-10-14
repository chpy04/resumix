import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let createCoverLetter: typeof import('./cover-letters.ts').createCoverLetter;
let getCoverLetter: typeof import('./cover-letters.ts').getCoverLetter;
let getDefaultCoverLetter: typeof import('./cover-letters.ts').getDefaultCoverLetter;
let listCoverLetters: typeof import('./cover-letters.ts').listCoverLetters;
let updateCoverLetter: typeof import('./cover-letters.ts').updateCoverLetter;
let deleteCoverLetterRow: typeof import('./test-fixtures.ts').deleteCoverLetterRow;
let seedUserId: typeof import('./test-fixtures.ts').seedUserId;
let testTag: typeof import('./test-fixtures.ts').testTag;
let closeTestDb: typeof import('./test-fixtures.ts').closeTestDb;

if (!skip) {
  ({ BadRequestError, NotFoundError } = await import('./errors.ts'));
  ({
    createCoverLetter,
    getCoverLetter,
    getDefaultCoverLetter,
    listCoverLetters,
    updateCoverLetter,
  } = await import('./cover-letters.ts'));
  ({ deleteCoverLetterRow, seedUserId, testTag, closeTestDb } = await import('./test-fixtures.ts'));
}

after(async () => {
  if (!skip) await closeTestDb();
});

test('createCoverLetter copies the default, verbatim', { skip }, async () => {
  const userId = await seedUserId();
  const fallback = await getDefaultCoverLetter(userId);
  assert.ok(fallback, 'the seeded user must have a default cover letter');

  const created = await createCoverLetter(userId, `Test Co ${testTag()}`);
  try {
    // Byte-for-byte. No token substitution, nothing derived from the name —
    // tailoring it for the job is the next thing the user does by hand.
    assert.equal(created.content, fallback.content);
    assert.equal(created.isDefault, false, 'a copy must never be the default');
    assert.equal(created.isArchived, false);
  } finally {
    await deleteCoverLetterRow(created.id);
  }
});

test('createCoverLetter can copy a letter other than the default', { skip }, async () => {
  const userId = await seedUserId();
  const source = await createCoverLetter(userId, `Source ${testTag()}`);
  const edited = await updateCoverLetter(userId, source.id, { content: 'Dear Specific Company,' });

  const copy = await createCoverLetter(userId, `Copy ${testTag()}`, source.id);
  try {
    assert.equal(copy.content, edited.content);
    assert.notEqual(copy.id, source.id);
  } finally {
    await deleteCoverLetterRow(copy.id);
    await deleteCoverLetterRow(source.id);
  }
});

test('createCoverLetter rejects a source id that does not exist', { skip }, async () => {
  const userId = await seedUserId();
  await assert.rejects(
    () => createCoverLetter(userId, 'Nope', '00000000-0000-4000-8000-000000000000'),
    BadRequestError,
  );
});

test('editing one letter leaves every other letter alone', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const first = await createCoverLetter(userId, `First ${tag}`);
  const second = await createCoverLetter(userId, `Second ${tag}`);
  try {
    await updateCoverLetter(userId, first.id, { content: 'Rewritten for the first job.' });

    // The opposite of the resume side, where editing a bullet changes every
    // resume that selected it. A letter is a private copy (D-035).
    const untouched = await getCoverLetter(userId, second.id);
    assert.equal(untouched?.content, second.content);
    const original = await getDefaultCoverLetter(userId);
    assert.notEqual(original?.content, 'Rewritten for the first job.');
  } finally {
    await deleteCoverLetterRow(second.id);
    await deleteCoverLetterRow(first.id);
  }
});

test('the default cover letter cannot be archived', { skip }, async () => {
  const userId = await seedUserId();
  const fallback = await getDefaultCoverLetter(userId);
  assert.ok(fallback);

  // Archiving it would leave every new letter with nothing to copy.
  await assert.rejects(
    () => updateCoverLetter(userId, fallback.id, { isArchived: true }),
    BadRequestError,
  );
});

test('archiving hides a letter from the default listing', { skip }, async () => {
  const userId = await seedUserId();
  const letter = await createCoverLetter(userId, `Archived ${testTag()}`);
  try {
    await updateCoverLetter(userId, letter.id, { isArchived: true });

    const visible = await listCoverLetters(userId, false);
    assert.ok(!visible.some((l) => l.id === letter.id));

    // Still there — archiving is not deleting (D-011), and with no PDF
    // snapshot this text is the only record of what was sent.
    const withArchived = await listCoverLetters(userId, true);
    assert.ok(withArchived.some((l) => l.id === letter.id));
  } finally {
    await deleteCoverLetterRow(letter.id);
  }
});

test('the default sorts first however recently the others were made', { skip }, async () => {
  const userId = await seedUserId();
  const letter = await createCoverLetter(userId, `Newest ${testTag()}`);
  try {
    const listed = await listCoverLetters(userId, false);
    assert.equal(listed[0]?.isDefault, true);
    assert.equal(listed[1]?.id, letter.id, 'then newest first');
  } finally {
    await deleteCoverLetterRow(letter.id);
  }
});

test('updating a letter that does not exist is a NotFoundError', { skip }, async () => {
  const userId = await seedUserId();
  await assert.rejects(
    () => updateCoverLetter(userId, '00000000-0000-4000-8000-000000000000', { name: 'Ghost' }),
    NotFoundError,
  );
});

// ---------------------------------------------------------------------------
// The plain-text body (D-046). `content` is the shell, `body` the prose that
// goes at its one `%%BODY%%` line, and a stored body always has exactly one.
// ---------------------------------------------------------------------------

const SHELL = '\\begin{document}\n%%BODY%%\n\\end{document}';

test('a new letter has no body, and a copy carries the body with it', { skip }, async () => {
  const userId = await seedUserId();
  const source = await createCoverLetter(userId, `Body Source ${testTag()}`);
  assert.equal(source.body, null);

  await updateCoverLetter(userId, source.id, { content: SHELL });
  const written = await updateCoverLetter(userId, source.id, { body: 'Dear Team,\n\nHi & bye.' });
  assert.equal(written.body, 'Dear Team,\n\nHi & bye.');
  // Plain text, stored as typed: escaping happens only when it renders.
  assert.equal((await getCoverLetter(userId, source.id))?.body, 'Dear Team,\n\nHi & bye.');

  const copy = await createCoverLetter(userId, `Body Copy ${testTag()}`, source.id);
  try {
    assert.equal(copy.content, SHELL);
    assert.equal(copy.body, 'Dear Team,\n\nHi & bye.');
  } finally {
    await deleteCoverLetterRow(copy.id);
    await deleteCoverLetterRow(source.id);
  }
});

test(
  'a body is refused, writing nothing, when the content has no single marker',
  { skip },
  async () => {
    const userId = await seedUserId();
    const letter = await createCoverLetter(userId, `Body Refused ${testTag()}`);
    try {
      for (const content of ['\\begin{document}\\end{document}', `${SHELL}\n%%BODY%%`]) {
        await updateCoverLetter(userId, letter.id, { content });
        await assert.rejects(
          () => updateCoverLetter(userId, letter.id, { body: 'Hello' }),
          (err: Error) => err instanceof BadRequestError && /%%BODY%%/.test(err.message),
        );
        const after = await getCoverLetter(userId, letter.id);
        assert.equal(after?.body, null, content);
        assert.equal(after?.content, content);
      }

      // The two columns in one patch are checked together.
      const both = await updateCoverLetter(userId, letter.id, { content: SHELL, body: 'Hello' });
      assert.equal(both.body, 'Hello');
    } finally {
      await deleteCoverLetterRow(letter.id);
    }
  },
);

test('with a body, removing the marker from the content is refused', { skip }, async () => {
  const userId = await seedUserId();
  const letter = await createCoverLetter(userId, `Marker Kept ${testTag()}`);
  try {
    await updateCoverLetter(userId, letter.id, { content: SHELL, body: 'Hello' });
    for (const content of ['\\begin{document}\\end{document}', `${SHELL}\n  %%BODY%%`]) {
      await assert.rejects(
        () => updateCoverLetter(userId, letter.id, { content }),
        BadRequestError,
        content,
      );
    }
    const after = await getCoverLetter(userId, letter.id);
    assert.equal(after?.content, SHELL);
    assert.equal(after?.body, 'Hello');

    // Moving the marker is fine: the rule is one line, not this line.
    const moved = await updateCoverLetter(userId, letter.id, {
      content: '\\begin{document}\n\\vspace{6pt}\n\t%%BODY%%\n\\end{document}',
    });
    assert.equal(moved.body, 'Hello');
  } finally {
    await deleteCoverLetterRow(letter.id);
  }
});

test('with no body, the content may be anything, marker or not', { skip }, async () => {
  const userId = await seedUserId();
  const letter = await createCoverLetter(userId, `LaTeX Only ${testTag()}`);
  try {
    for (const content of ['\\begin{document}\\end{document}', `${SHELL}\n%%BODY%%`, '']) {
      const written = await updateCoverLetter(userId, letter.id, { content });
      assert.equal(written.content, content);
      assert.equal(written.body, null);
    }
  } finally {
    await deleteCoverLetterRow(letter.id);
  }
});
