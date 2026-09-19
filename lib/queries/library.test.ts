import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let assembleLibrary: typeof import('./library.ts').assembleLibrary;
let insertExperience: typeof import('./test-fixtures.ts').insertExperience;
let insertExperienceBullet: typeof import('./test-fixtures.ts').insertExperienceBullet;
let seedUserId: typeof import('./test-fixtures.ts').seedUserId;
let testTag: typeof import('./test-fixtures.ts').testTag;
let closeTestDb: typeof import('./test-fixtures.ts').closeTestDb;

if (!skip) {
  ({ assembleLibrary } = await import('./library.ts'));
  ({ insertExperience, insertExperienceBullet, seedUserId, testTag, closeTestDb } = await import(
    './test-fixtures.ts'
  ));
}

after(async () => {
  if (!skip) await closeTestDb();
});

test('assembleLibrary(userId, false) excludes archived experiences; assembleLibrary(userId, true) includes them', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const archived = await insertExperience(userId, tag, { isArchived: true });

  const withoutArchived = await assembleLibrary(userId, false);
  assert.ok(
    !withoutArchived.experiences.some((e) => e.id === archived.id),
    'archived experience must be excluded by default',
  );

  const withArchived = await assembleLibrary(userId, true);
  assert.ok(
    withArchived.experiences.some((e) => e.id === archived.id),
    'archived experience must be included with includeArchived=true',
  );
});

test('assembleLibrary attaches each experience\'s own bullets, not another\'s', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const a = await insertExperience(userId, `${tag}-a`);
  const b = await insertExperience(userId, `${tag}-b`);
  await insertExperienceBullet(a.id, 'Bullet for A');
  await insertExperienceBullet(b.id, 'Bullet for B');

  const library = await assembleLibrary(userId, true);
  const foundA = library.experiences.find((e) => e.id === a.id);
  const foundB = library.experiences.find((e) => e.id === b.id);
  assert.ok(foundA && foundB);
  assert.equal(foundA!.bullets.length, 1);
  assert.equal(foundA!.bullets[0]?.content, 'Bullet for A');
  assert.equal(foundB!.bullets.length, 1);
  assert.equal(foundB!.bullets[0]?.content, 'Bullet for B');
});

test('an archived bullet under a non-archived parent is excluded by default, included with includeArchived=true', { skip }, async () => {
  const userId = await seedUserId();
  const tag = testTag();
  const exp = await insertExperience(userId, tag);
  const keptBullet = await insertExperienceBullet(exp.id, 'Kept bullet', false);
  const archivedBullet = await insertExperienceBullet(exp.id, 'Archived bullet', true);

  const withoutArchived = await assembleLibrary(userId, false);
  const foundWithout = withoutArchived.experiences.find((e) => e.id === exp.id);
  assert.ok(foundWithout);
  assert.deepEqual(
    foundWithout!.bullets.map((b) => b.id),
    [keptBullet.id],
    'archived bullet must be excluded even though its parent experience is not archived',
  );

  const withArchived = await assembleLibrary(userId, true);
  const foundWith = withArchived.experiences.find((e) => e.id === exp.id);
  assert.ok(foundWith);
  const idsWith = foundWith!.bullets.map((b) => b.id).sort();
  assert.deepEqual(idsWith, [archivedBullet.id, keptBullet.id].sort());
});
