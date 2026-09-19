/**
 * The multi-user guarantee, stated as tests (T14).
 *
 * Every case here is the same shape: user A holds an id belonging to user
 * B, and tries to use it. The expected answer is always "that does not
 * exist" — never a partial success, and never a 403-flavoured error that
 * would confirm the id is real.
 *
 * These run against a real database (see test-fixtures.ts) because the
 * thing under test *is* the WHERE clause. Mocking the query layer here
 * would assert nothing.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let assembleLibrary: typeof import('./library.ts').assembleLibrary;
let createResume: typeof import('./resumes.ts').createResume;
let deleteResume: typeof import('./resumes.ts').deleteResume;
let getResumeDetail: typeof import('./resumes.ts').getResumeDetail;
let getResumeRow: typeof import('./resumes.ts').getResumeRow;
let listResumeSummaries: typeof import('./resumes.ts').listResumeSummaries;
let updateResume: typeof import('./resumes.ts').updateResume;
let updateExperience: typeof import('./experiences.ts').updateExperience;
let getExperienceById: typeof import('./experiences.ts').getExperienceById;
let createExperienceBullet: typeof import('./experience-bullets.ts').createExperienceBullet;
let updateExperienceBullet: typeof import('./experience-bullets.ts').updateExperienceBullet;
let updateSkillRow: typeof import('./skill-rows.ts').updateSkillRow;
let createSkill: typeof import('./skills.ts').createSkill;
let updateSkill: typeof import('./skills.ts').updateSkill;
let getTemplateById: typeof import('./templates.ts').getTemplateById;
let updateTemplate: typeof import('./templates.ts').updateTemplate;
let getDefaultTemplate: typeof import('./templates.ts').getDefaultTemplate;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let getSelections: typeof import('./selections.ts').getSelections;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError, NotFoundError } = await import('./errors.ts'));
  ({ assembleLibrary } = await import('./library.ts'));
  ({ createResume, deleteResume, getResumeDetail, getResumeRow, listResumeSummaries, updateResume } =
    await import('./resumes.ts'));
  ({ getExperienceById, updateExperience } = await import('./experiences.ts'));
  ({ createExperienceBullet, updateExperienceBullet } = await import('./experience-bullets.ts'));
  ({ updateSkillRow } = await import('./skill-rows.ts'));
  ({ createSkill, updateSkill } = await import('./skills.ts'));
  ({ getDefaultTemplate, getTemplateById, updateTemplate } = await import('./templates.ts'));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

/** Two fully-provisioned accounts, each with content of their own. */
async function twoUsers() {
  const tag = fixtures.testTag();
  const alice = await fixtures.insertUser(`a-${tag}`);
  const bob = await fixtures.insertUser(`b-${tag}`);

  const aliceExp = await fixtures.insertExperience(alice.id, `a-${tag}`);
  const aliceBullet = await fixtures.insertExperienceBullet(aliceExp.id, 'Alice did a thing');
  const bobExp = await fixtures.insertExperience(bob.id, `b-${tag}`);
  const bobBullet = await fixtures.insertExperienceBullet(bobExp.id, 'Bob did a thing');

  return { tag, alice, bob, aliceExp, aliceBullet, bobExp, bobBullet };
}

test('provisionUser gives every new account its own default template and Default resume', { skip }, async () => {
  const user = await fixtures.insertUser(fixtures.testTag());

  const template = await getDefaultTemplate(user.id);
  assert.ok(template, 'a new user must have a default template');

  const resumes = await listResumeSummaries(user.id);
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0]?.isDefault, true);
  assert.equal(resumes[0]?.templateId, template!.id);
});

test('two users can each have a default resume and template (the unique index is per-user)', { skip }, async () => {
  // Before T14 `ux_resume_one_default` was global, so the second account
  // provisioned would have collided.
  const a = await fixtures.insertUser(`x-${fixtures.testTag()}`);
  const b = await fixtures.insertUser(`y-${fixtures.testTag()}`);

  assert.ok(await getDefaultTemplate(a.id));
  assert.ok(await getDefaultTemplate(b.id));
  assert.notEqual((await getDefaultTemplate(a.id))!.id, (await getDefaultTemplate(b.id))!.id);
});

test("a user's library contains none of another user's content", { skip }, async () => {
  const { alice, bob, aliceExp, bobExp } = await twoUsers();

  const aliceLibrary = await assembleLibrary(alice.id, true);
  assert.ok(aliceLibrary.experiences.some((e) => e.id === aliceExp.id));
  assert.ok(
    !aliceLibrary.experiences.some((e) => e.id === bobExp.id),
    "Bob's experience must not appear in Alice's library",
  );

  // ...and neither do the bullets hanging off it, which have no user_id of
  // their own and so are the easiest thing to leak.
  const allBulletContents = aliceLibrary.experiences.flatMap((e) => e.bullets.map((b) => b.content));
  assert.ok(!allBulletContents.includes('Bob did a thing'));

  // Templates are per-user too.
  const bobTemplate = await getDefaultTemplate(bob.id);
  assert.ok(!aliceLibrary.templates.some((t) => t.id === bobTemplate!.id));
});

test("another user's resume reads as nonexistent, not forbidden", { skip }, async () => {
  const { alice, bob } = await twoUsers();
  const bobResume = (await listResumeSummaries(bob.id))[0]!;

  assert.equal(await getResumeRow(alice.id, bobResume.id), null);
  assert.equal(await getResumeDetail(alice.id, bobResume.id), null);
  assert.ok(!(await listResumeSummaries(alice.id)).some((r) => r.id === bobResume.id));
});

test("deleting another user's resume fails and leaves it intact", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobResume = await createResume(bob.id, `Bob Target ${tag}`);
  try {
    await assert.rejects(() => deleteResume(alice.id, bobResume.id), NotFoundError);
    assert.ok(await getResumeRow(bob.id, bobResume.id), "Bob's resume must survive");
  } finally {
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test("renaming another user's resume fails", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobResume = await createResume(bob.id, `Bob Rename ${tag}`);
  try {
    await assert.rejects(() => updateResume(alice.id, bobResume.id, { name: 'pwned' }), NotFoundError);
    const still = await getResumeRow(bob.id, bobResume.id);
    assert.equal(still?.name, `Bob Rename ${tag}`);
  } finally {
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test("editing another user's experience, bullet, skill row, skill, or template all fail", { skip }, async () => {
  const { alice, bob, bobExp, bobBullet, tag } = await twoUsers();
  const bobRow = await fixtures.insertSkillRow(bob.id, `b-${tag}`);
  const bobSkill = await fixtures.insertSkill(bobRow.id, 'Rust');
  const bobTemplate = (await getDefaultTemplate(bob.id))!;

  await assert.rejects(() => updateExperience(alice.id, bobExp.id, { company: 'pwned' }), NotFoundError);
  await assert.rejects(() => updateExperienceBullet(alice.id, bobBullet.id, { content: 'pwned' }), NotFoundError);
  await assert.rejects(() => updateSkillRow(alice.id, bobRow.id, { name: 'pwned' }), NotFoundError);
  await assert.rejects(() => updateSkill(alice.id, bobSkill.id, { name: 'pwned' }), NotFoundError);
  await assert.rejects(() => updateTemplate(alice.id, bobTemplate.id, { content: 'pwned' }), NotFoundError);

  // And nothing was actually written.
  const bobLibrary = await assembleLibrary(bob.id, true);
  const exp = bobLibrary.experiences.find((e) => e.id === bobExp.id);
  assert.notEqual(exp?.company, 'pwned');
  assert.equal(exp?.bullets.find((b) => b.id === bobBullet.id)?.content, 'Bob did a thing');
  assert.equal((await getTemplateById(bob.id, bobTemplate.id))?.content, bobTemplate.content);
});

test("appending a bullet to another user's experience fails", { skip }, async () => {
  const { alice, bobExp } = await twoUsers();
  assert.equal(await getExperienceById(alice.id, bobExp.id), null);
  await assert.rejects(() => createExperienceBullet(alice.id, bobExp.id, 'injected'), NotFoundError);
});

test("adding a skill to another user's skill row fails", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobRow = await fixtures.insertSkillRow(bob.id, `skills-${tag}`);
  await assert.rejects(() => createSkill(alice.id, bobRow.id, 'injected'), NotFoundError);
});

test("another user's content cannot be selected onto your own resume", { skip }, async () => {
  const { alice, bobExp, bobBullet, tag } = await twoUsers();
  const aliceResume = await fixtures.insertTestResume(alice.id, tag);
  try {
    // The bridge tables carry no user_id, so this is the path that would
    // otherwise let Bob's content render on Alice's resume.
    await assert.rejects(
      () => replaceSelections(alice.id, aliceResume.id, { experiences: [bobExp.id] }),
      BadRequestError,
    );
    await assert.rejects(
      () =>
        replaceSelections(alice.id, aliceResume.id, {
          experienceBullets: { [bobExp.id]: [bobBullet.id] },
        }),
      BadRequestError,
    );

    const selections = await getSelections(aliceResume.id);
    assert.deepEqual(selections.experiences, [], 'nothing may have been written');
  } finally {
    await fixtures.deleteResumeRow(aliceResume.id);
  }
});

test("a resume cannot be pointed at another user's template", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobTemplate = (await getDefaultTemplate(bob.id))!;
  const aliceResume = await fixtures.insertTestResume(alice.id, tag);
  try {
    await assert.rejects(
      () => updateResume(alice.id, aliceResume.id, { templateId: bobTemplate.id }),
      BadRequestError,
    );
    const still = await getResumeRow(alice.id, aliceResume.id);
    assert.notEqual(still?.templateId, bobTemplate.id);
  } finally {
    await fixtures.deleteResumeRow(aliceResume.id);
  }
});

test('createResume clones your own default, never the other user\'s', { skip }, async () => {
  const { alice, bob, aliceExp, bobExp, tag } = await twoUsers();

  // Put each user's own experience on their own Default resume.
  const aliceDefault = await fixtures.getDefaultResumeRow(alice.id);
  const bobDefault = await fixtures.getDefaultResumeRow(bob.id);
  await replaceSelections(alice.id, aliceDefault.id, { experiences: [aliceExp.id] });
  await replaceSelections(bob.id, bobDefault.id, { experiences: [bobExp.id] });

  const clone = await createResume(bob.id, `Bob Clone ${tag}`);
  try {
    const selections = await getSelections(clone.id);
    assert.deepEqual(selections.experiences, [bobExp.id]);
  } finally {
    await fixtures.deleteResumeRow(clone.id);
  }
});
