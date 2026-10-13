/**
 * `create_application` against a real database: a `proposing` application
 * holding its own copy of Default, and nothing at all when the arguments
 * are wrong.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let createApplication: typeof import('./create-application.ts').createApplication;
let applications: typeof import('../../queries/applications.ts');
let resumes: typeof import('../../queries/resumes.ts');
let selections: typeof import('../../queries/selections.ts');
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ createApplication } = await import('./create-application.ts'));
  applications = await import('../../queries/applications.ts');
  resumes = await import('../../queries/resumes.ts');
  selections = await import('../../queries/selections.ts');
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

function args(tag: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company: `Acme ${tag}`,
    role_title: 'Platform Engineer',
    posting_url: `https://jobs.example.test/${tag}`,
    job_description: 'Build the platform.',
    agent_summary: 'Strong fit.\nRemote friendly.',
    fit_score: 4.3,
    ...overrides,
  };
}

test(
  'create_application makes a proposing application with a copy of Default',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`create-${tag}`);
    const exp = await fixtures.insertExperience(user.id, tag);
    const bullet = await fixtures.insertExperienceBullet(exp.id, 'Did it');
    const defaultResume = await fixtures.getDefaultResumeRow(user.id);
    await selections.replaceSelections(user.id, defaultResume.id, {
      experiences: [exp.id],
      experienceBullets: { [exp.id]: [bullet.id] },
    });

    const result = await createApplication.call({ userId: user.id }, args(tag));
    assert.equal(result.isError, undefined, result.content[0]?.text);
    const body = JSON.parse(result.content[0]?.text ?? '') as { application_id: string };
    assert.deepEqual(body, { application_id: body.application_id, status: 'proposing' });

    const row = await applications.getApplicationRow(user.id, body.application_id);
    assert.ok(row?.resumeId);
    try {
      assert.equal(row.status, 'proposing');
      assert.equal(row.company, `Acme ${tag}`);
      assert.equal(row.roleTitle, 'Platform Engineer');
      assert.equal(row.postingUrl, `https://jobs.example.test/${tag}`);
      assert.equal(row.jobDescription, 'Build the platform.');
      assert.equal(row.agentSummary, 'Strong fit.\nRemote friendly.');
      assert.equal(row.fitScore, 4.3);
      // Not stamped: proposing has not been sent anywhere (D-041).
      assert.equal(row.appliedAt, null);
      assert.equal(row.proposedSelection, null);

      const copy = await resumes.getResumeRow(user.id, row.resumeId);
      assert.equal(copy?.name, `Acme ${tag}`);
      assert.equal(copy?.isDefault, false);
      assert.deepEqual(
        await selections.getSelections(row.resumeId),
        await selections.getSelections(defaultResume.id),
      );
    } finally {
      await fixtures.deleteApplicationRow(row.id);
      await fixtures.deleteResumeRow(row.resumeId);
    }
  },
);

test('create_application accepts every one-decimal score from 0.0 to 5.0', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`create-ok-${tag}`);
  for (const fit_score of [0, 0.3, 5]) {
    const result = await createApplication.call({ userId: user.id }, args(tag, { fit_score }));
    assert.equal(result.isError, undefined, result.content[0]?.text);
  }
  for (const a of await applications.listApplications(user.id, true)) {
    await fixtures.deleteApplicationRow(a.id);
    if (a.resumeId) await fixtures.deleteResumeRow(a.resumeId);
  }
});

test('bad arguments create nothing: no application and no resume', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`create-bad-${tag}`);
  const cases: [Record<string, unknown>, RegExp][] = [
    [args(tag, { fit_score: 4.25 }), /fit_score: must have at most one decimal place/],
    [args(tag, { fit_score: 5.1 }), /fit_score: must be 0\.0 to 5\.0/],
    [args(tag, { fit_score: -0.1 }), /fit_score: must be 0\.0 to 5\.0/],
    [args(tag, { posting_url: 'javascript:alert(1)' }), /posting_url: must be an http\(s\) URL/],
    [args(tag, { agent_summary: '   ' }), /agent_summary: is required/],
    [args(tag, { companyName: 'x' }), /Unrecognized key/],
    [{ company: 'Acme' }, /role_title/],
  ];
  for (const [input, message] of cases) {
    const result = await createApplication.call({ userId: user.id }, input);
    assert.equal(result.isError, true, JSON.stringify(input));
    assert.match(result.content[0]?.text ?? '', message);
  }
  assert.deepEqual(await applications.listApplications(user.id, true), []);
  assert.deepEqual(
    (await resumes.listResumeSummaries(user.id)).map((r) => r.name),
    ['Default'],
  );
});
