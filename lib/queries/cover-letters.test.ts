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
