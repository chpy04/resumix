import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let BadRequestError: typeof import('./errors.ts').BadRequestError;
let createResume: typeof import('./resumes.ts').createResume;
let deleteResume: typeof import('./resumes.ts').deleteResume;
let getResumeDetail: typeof import('./resumes.ts').getResumeDetail;
let getResumeRow: typeof import('./resumes.ts').getResumeRow;
let getSelections: typeof import('./selections.ts').getSelections;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let deleteResumeRow: typeof import('./test-fixtures.ts').deleteResumeRow;
let getDefaultResumeRow: typeof import('./test-fixtures.ts').getDefaultResumeRow;
let insertExperience: typeof import('./test-fixtures.ts').insertExperience;
let insertExperienceBullet: typeof import('./test-fixtures.ts').insertExperienceBullet;
let seedUserId: typeof import('./test-fixtures.ts').seedUserId;
let testTag: typeof import('./test-fixtures.ts').testTag;
let closeTestDb: typeof import('./test-fixtures.ts').closeTestDb;

if (!skip) {
  ({ BadRequestError } = await import('./errors.ts'));
  ({ createResume, deleteResume, getResumeDetail, getResumeRow } = await import('./resumes.ts'));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  ({
    deleteResumeRow,
    getDefaultResumeRow,
    insertExperience,
    insertExperienceBullet,
    seedUserId,
    testTag,
    closeTestDb,
  } = await import('./test-fixtures.ts'));
}

after(async () => {
  if (!skip) await closeTestDb();
});

test("createResume clones the default resume's template and selections", { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const defaultResume = await getDefaultResumeRow(userId);
  const exp = await insertExperience(userId, tag);

  // Select the new experience onto the *default* resume so we have
  // something distinctive to check got copied, then restore afterward.
  const originalDefaultSelections = await getSelections(defaultResume.id);
  await replaceSelections(userId, defaultResume.id, {
    experiences: [...originalDefaultSelections.experiences, exp.id],
  });

  let clone;
  try {
    clone = await createResume(userId, `T6 Clone Test ${tag}`);
    assert.equal(clone.templateId, defaultResume.templateId);
    assert.equal(clone.isDefault, false);

    const cloneSelections = await getSelections(clone.id);
    assert.ok(
      cloneSelections.experiences.includes(exp.id),
      "clone must include the default resume's selections",
    );
    assert.deepEqual(
      cloneSelections.experiences,
      [...originalDefaultSelections.experiences, exp.id],
      'clone must preserve order',
    );
  } finally {
    if (clone) await deleteResumeRow(clone.id);
    // Restore the default resume's selections to their pre-test state.
    await replaceSelections(userId, defaultResume.id, {
      experiences: originalDefaultSelections.experiences,
    });
  }
});

test('deleteResume rejects the default resume with BadRequestError', { skip }, async () => {
  const userId = await seedUserId();
  const defaultResume = await getDefaultResumeRow(userId);
  await assert.rejects(() => deleteResume(userId, defaultResume.id), BadRequestError);
  // It must still be there.
  const stillThere = await getResumeRow(userId, defaultResume.id);
  assert.ok(stillThere);
});

test('deleteResume removes a non-default resume', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const clone = await createResume(userId, `T6 Delete Test ${tag}`);
  await deleteResume(userId, clone.id);
  const gone = await getResumeRow(userId, clone.id);
  assert.equal(gone, null);
});

test(
  'getResumeDetail includes archived library content (the UI filters it, not the API)',
  { skip },
  async () => {
    const userId = await seedUserId();
    const tag = testTag();
    const archivedExp = await insertExperience(userId, tag, { isArchived: true });
    await insertExperienceBullet(archivedExp.id, 'Archived bullet', true);

    const defaultResume = await getDefaultResumeRow(userId);
    const detail = await getResumeDetail(userId, defaultResume.id);
    assert.ok(detail);
    const found = detail!.library.experiences.find((e) => e.id === archivedExp.id);
    assert.ok(found, 'archived experience must still be present in the library payload');
    assert.equal(found!.isArchived, true);
  },
);

test('getResumeDetail returns null for a nonexistent resume', { skip }, async () => {
  const userId = await seedUserId();
  const detail = await getResumeDetail(userId, '00000000-0000-0000-0000-000000000000');
  assert.equal(detail, null);
});
