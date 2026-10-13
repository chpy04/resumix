/**
 * `get_library` against a real database: live content only (C9), the
 * caller's only, and in plain text.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let getLibrary: typeof import('./get-library.ts').getLibrary;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ getLibrary } = await import('./get-library.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

interface LibraryJson {
  experiences: { id: string; company: string; bullets: { id: string; text: string }[] }[];
  projects: { id: string; name: string; bullets: { id: string; text: string }[] }[];
  skill_rows: { id: string; name: string; top: boolean; skills: { id: string; name: string }[] }[];
}

async function libraryOf(userId: string): Promise<LibraryJson> {
  const result = await getLibrary.call({ userId }, {});
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0]?.text ?? '') as LibraryJson;
}

test(
  'get_library returns live content only, with archived children and parents absent',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`lib-${tag}`);

    const live = await fixtures.insertExperience(user.id, tag);
    const kept = await fixtures.insertExperienceBullet(live.id, 'Kept');
    const archivedBullet = await fixtures.insertExperienceBullet(live.id, 'Archived', true);
    const archived = await fixtures.insertExperience(user.id, `${tag}-gone`, { isArchived: true });
    const underArchived = await fixtures.insertExperienceBullet(archived.id, 'Under archived');
    const project = await fixtures.insertProject(user.id, tag);
    const projectBullet = await fixtures.insertProjectBullet(project.id, 'Built it');
    const row = await fixtures.insertSkillRow(user.id, tag);
    const skill = await fixtures.insertSkill(row.id, 'TypeScript');

    const library = await libraryOf(user.id);

    assert.deepEqual(
      library.experiences.map((e) => [e.id, e.bullets.map((b) => b.id)]),
      [[live.id, [kept.id]]],
    );
    const text = JSON.stringify(library);
    for (const absent of [archivedBullet.id, archived.id, underArchived.id]) {
      assert.ok(!text.includes(absent), `${absent} should be absent`);
    }
    assert.deepEqual(library.projects[0]?.bullets, [{ id: projectBullet.id, text: 'Built it' }]);
    assert.deepEqual(library.skill_rows, [
      { id: row.id, name: row.name, top: true, skills: [{ id: skill.id, name: 'TypeScript' }] },
    ]);
  },
);

test("get_library contains none of another user's ids", { skip }, async () => {
  const tag = fixtures.testTag();
  const alice = await fixtures.insertUser(`lib-a-${tag}`);
  const bob = await fixtures.insertUser(`lib-b-${tag}`);
  const bobExp = await fixtures.insertExperience(bob.id, tag);
  const bobBullet = await fixtures.insertExperienceBullet(bobExp.id, 'Bob did it');
  await fixtures.insertExperience(alice.id, tag);

  const text = JSON.stringify(await libraryOf(alice.id));
  assert.ok(!text.includes(bobExp.id));
  assert.ok(!text.includes(bobBullet.id));
});

test('get_library text is plain: no LaTeX survives', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`lib-tex-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  await fixtures.insertExperienceBullet(
    exp.id,
    'Grew \\textbf{\\$40k} \\& shipped \\href{https://x.test}{\\underline{the site}} by 50\\%',
  );

  const library = await libraryOf(user.id);
  assert.equal(library.experiences[0]?.bullets[0]?.text, 'Grew $40k & shipped the site by 50%');
  // Every string in the payload, keys aside.
  const values = JSON.stringify(library).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  for (const value of values) assert.doesNotMatch(JSON.parse(value) as string, /[\\{}]/);
});

test("the seeded user's whole library comes out as plain text", { skip }, async () => {
  const library = await libraryOf(await fixtures.seedUserId());
  assert.ok(library.experiences.length > 0);
  const strings = [
    ...library.experiences.flatMap((e) => [e.company, ...e.bullets.map((b) => b.text)]),
    ...library.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)]),
    ...library.skill_rows.flatMap((r) => [r.name, ...r.skills.map((s) => s.name)]),
  ];
  for (const s of strings) assert.doesNotMatch(s, /[\\{}]/, s);
});
