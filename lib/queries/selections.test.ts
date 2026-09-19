import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let db: typeof import('../db/index.ts').db;
let resumeExperience: typeof import('../db/schema.ts').resumeExperience;
let eq: typeof import('drizzle-orm').eq;
let BadRequestError: typeof import('./errors.ts').BadRequestError;
let getSelections: typeof import('./selections.ts').getSelections;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let deleteResumeRow: typeof import('./test-fixtures.ts').deleteResumeRow;
let insertExperience: typeof import('./test-fixtures.ts').insertExperience;
let insertExperienceBullet: typeof import('./test-fixtures.ts').insertExperienceBullet;
let insertProject: typeof import('./test-fixtures.ts').insertProject;
let insertTestResume: typeof import('./test-fixtures.ts').insertTestResume;
let seedUserId: typeof import('./test-fixtures.ts').seedUserId;
let testTag: typeof import('./test-fixtures.ts').testTag;
let closeTestDb: typeof import('./test-fixtures.ts').closeTestDb;

if (!skip) {
  ({ db } = await import('../db/index.ts'));
  ({ resumeExperience } = await import('../db/schema.ts'));
  ({ eq } = await import('drizzle-orm'));
  ({ BadRequestError } = await import('./errors.ts'));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  ({
    deleteResumeRow,
    insertExperience,
    insertExperienceBullet,
    insertProject,
    insertTestResume,
    seedUserId,
    testTag,
    closeTestDb,
  } = await import('./test-fixtures.ts'));
}

after(async () => {
  if (!skip) await closeTestDb();
});

test('a freshly created resume has empty selections', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  try {
    const selections = await getSelections(resume.id);
    assert.deepEqual(selections, {
      experiences: [],
      experienceBullets: {},
      projects: [],
      projectBullets: {},
      skillRows: [],
      skills: {},
    });
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('replaceSelections sets sort_order = array index and getSelections round-trips it', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const a = await insertExperience(userId, `${tag}-a`);
  const b = await insertExperience(userId, `${tag}-b`);
  try {
    // Reversed relative to insertion order — sort_order must follow the array, not insertion.
    await replaceSelections(userId, resume.id, { experiences: [b.id, a.id] });

    const selections = await getSelections(resume.id);
    assert.deepEqual(selections.experiences, [b.id, a.id]);
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('replaceSelections is idempotent — calling twice with the same array does not duplicate rows', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const a = await insertExperience(userId, tag);
  try {
    await replaceSelections(userId, resume.id, { experiences: [a.id] });
    await replaceSelections(userId, resume.id, { experiences: [a.id] });

    const rows = await db
      .select()
      .from(resumeExperience)
      .where(eq(resumeExperience.resumeId, resume.id));
    assert.equal(rows.length, 1);
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('a slice absent from the patch is left untouched', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const exp = await insertExperience(userId, tag);
  const proj = await insertProject(userId, tag);
  try {
    await replaceSelections(userId, resume.id, { experiences: [exp.id] });
    await replaceSelections(userId, resume.id, { projects: [proj.id] });

    const selections = await getSelections(resume.id);
    assert.deepEqual(selections.experiences, [exp.id], 'experiences slice must survive an unrelated projects PUT');
    assert.deepEqual(selections.projects, [proj.id]);
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('an unknown id in one slice rejects the whole request with BadRequestError and rolls back the transaction', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const exp = await insertExperience(userId, tag);
  const proj = await insertProject(userId, tag);
  try {
    // Seed a known-good baseline.
    await replaceSelections(userId, resume.id, { experiences: [exp.id] });

    await assert.rejects(
      () =>
        replaceSelections(userId, resume.id, {
          projects: [proj.id],
          skillRows: ['00000000-0000-0000-0000-000000000000'],
        }),
      BadRequestError,
    );

    // Neither slice from the rejected call should have been applied —
    // "all in one transaction" per docs/API.md.
    const selections = await getSelections(resume.id);
    assert.deepEqual(selections.experiences, [exp.id], 'unrelated prior state must be untouched');
    assert.deepEqual(selections.projects, [], 'the good slice in the rejected request must not partially apply');
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('experienceBullets rejects a bullet id nested under the wrong experience', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const expA = await insertExperience(userId, `${tag}-a`);
  const expB = await insertExperience(userId, `${tag}-b`);
  const bulletOfA = await insertExperienceBullet(expA.id, 'Did a thing');
  try {
    await assert.rejects(
      () =>
        replaceSelections(userId, resume.id, {
          experienceBullets: { [expB.id]: [bulletOfA.id] },
        }),
      BadRequestError,
    );
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('experienceBullets orders bullets per-parent and round-trips through getSelections', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  const exp = await insertExperience(userId, tag);
  const bulletA = await insertExperienceBullet(exp.id, 'First');
  const bulletB = await insertExperienceBullet(exp.id, 'Second');
  try {
    await replaceSelections(userId, resume.id, {
      experiences: [exp.id],
      experienceBullets: { [exp.id]: [bulletB.id, bulletA.id] },
    });

    const selections = await getSelections(resume.id);
    assert.deepEqual(selections.experienceBullets[exp.id], [bulletB.id, bulletA.id]);
  } finally {
    await deleteResumeRow(resume.id);
  }
});

test('replaceSelections on a nonexistent id rejects without writing any row', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const resume = await insertTestResume(userId, tag);
  try {
    await assert.rejects(
      () => replaceSelections(userId, resume.id, { experiences: ['00000000-0000-0000-0000-000000000000'] }),
      BadRequestError,
    );
    const rows = await db
      .select()
      .from(resumeExperience)
      .where(eq(resumeExperience.resumeId, resume.id));
    assert.equal(rows.length, 0, 'the bad id must never be written as a dangling row');
  } finally {
    await deleteResumeRow(resume.id);
  }
});
