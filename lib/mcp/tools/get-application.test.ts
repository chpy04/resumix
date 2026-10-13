/**
 * `get_application` against a real database: the whole state the agent
 * resumes from, and the same "No application" for archived, unknown and
 * another user's ids.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let getApplication: typeof import('./get-application.ts').getApplication;
let replaceSelections: typeof import('../../queries/selections.ts').replaceSelections;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ getApplication } = await import('./get-application.ts'));
  ({ replaceSelections } = await import('../../queries/selections.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

test(
  'get_application returns status, posting, summary, selection and approval',
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const user = await fixtures.insertUser(`get-${tag}`);
    const exp = await fixtures.insertExperience(user.id, tag);
    const bullet = await fixtures.insertExperienceBullet(exp.id, 'Did it');
    const resume = await fixtures.insertTestResume(user.id, tag);
    await replaceSelections(user.id, resume.id, {
      experiences: [exp.id],
      experienceBullets: { [exp.id]: [bullet.id] },
    });
    const approvedAt = new Date('2026-10-01T12:00:00.000Z');
    const app = await fixtures.insertTestApplication(user.id, tag, {
      status: 'needs_review',
      postingUrl: 'https://jobs.example.test/1',
      resumeId: resume.id,
      jobDescription: 'Build things.',
      agentSummary: 'Strong fit.\nRemote.',
      fitScore: 4.5,
      resumeApprovedAt: approvedAt,
    });
    try {
      const result = await getApplication.call({ userId: user.id }, { application_id: app.id });
      assert.equal(result.isError, undefined, result.content[0]?.text);
      assert.deepEqual(JSON.parse(result.content[0]?.text ?? ''), {
        application_id: app.id,
        company: app.company,
        role_title: app.roleTitle,
        posting_url: 'https://jobs.example.test/1',
        status: 'needs_review',
        fit_score: 4.5,
        job_description: 'Build things.',
        agent_summary: 'Strong fit.\nRemote.',
        selection: {
          experiences: [exp.id],
          experience_bullets: { [exp.id]: [bullet.id] },
          projects: [],
          project_bullets: {},
          skill_rows: [],
          skills: {},
        },
        approval: {
          resume_approved_at: approvedAt.toISOString(),
          cover_letter_approved_at: null,
          approved_at: null,
        },
      });
    } finally {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
    }
  },
);

test('an application with no resume has a null selection', { skip }, async () => {
  const user = await fixtures.insertUser(`get-none-${fixtures.testTag()}`);
  const app = await fixtures.insertTestApplication(user.id, fixtures.testTag());
  try {
    const result = await getApplication.call({ userId: user.id }, { application_id: app.id });
    const body = JSON.parse(result.content[0]?.text ?? '') as Record<string, unknown>;
    assert.equal(body.selection, null);
    assert.equal(body.job_description, null);
    assert.equal(body.fit_score, null);
  } finally {
    await fixtures.deleteApplicationRow(app.id);
  }
});

test(
  "archived, unknown and another user's applications all read as No application",
  { skip },
  async () => {
    const tag = fixtures.testTag();
    const alice = await fixtures.insertUser(`get-a-${tag}`);
    const bob = await fixtures.insertUser(`get-b-${tag}`);
    const archived = await fixtures.insertTestApplication(alice.id, `${tag}-a`, {
      isArchived: true,
    });
    const bobs = await fixtures.insertTestApplication(bob.id, `${tag}-b`);
    try {
      for (const id of [archived.id, bobs.id, randomUUID()]) {
        const result = await getApplication.call({ userId: alice.id }, { application_id: id });
        assert.equal(result.isError, true);
        assert.equal(
          result.content[0]?.text,
          `No application ${id}. Call list_applications to find its application_id.`,
        );
      }
    } finally {
      await fixtures.deleteApplicationRow(archived.id);
      await fixtures.deleteApplicationRow(bobs.id);
    }
  },
);
