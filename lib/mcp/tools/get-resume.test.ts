/**
 * `get_resume` against a real database: Default when no resume is named,
 * what it shows in `edit_resume_selection`'s shape, and what became of each
 * suggestion on it (D-054). Every refusal says what to call instead.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let getResume: typeof import('./get-resume.ts').getResume;
let setup: typeof import('./resume-tools.fixture.ts').resumeToolsSetup;
let text: typeof import('./resume-tools.fixture.ts').text;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ getResume } = await import('./get-resume.ts'));
  ({ resumeToolsSetup: setup, text } = await import('./resume-tools.fixture.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

test(
  'with no resume named it is Default, with its suggestions and their fate',
  { skip },
  async () => {
    const s = await setup();
    try {
      const rejected = await fixtures.insertResumeSuggestion(s.defaultResume.id, {
        bulletId: s.b1.id,
        status: 'rejected',
      });
      const add = await fixtures.insertResumeSuggestion(s.defaultResume.id, {
        kind: 'add',
        parentId: s.exp.id,
        position: 2,
        proposedText: 'Mentored two engineers',
      });

      const result = await getResume.call({ userId: s.user.id }, {});
      assert.equal(result.isError, undefined, text(result));
      assert.deepEqual(JSON.parse(text(result)), {
        resume_id: s.defaultResume.id,
        name: s.defaultResume.name,
        is_default: true,
        editor_path: `/resume/${s.defaultResume.id}`,
        selection: {
          experiences: [s.exp.id],
          experience_bullets: { [s.exp.id]: [s.b1.id, s.b2.id] },
          projects: [],
          project_bullets: {},
          skill_rows: [],
          skills: {},
        },
        bullet_suggestions: [
          {
            suggestion_id: rejected.id,
            kind: 'edit',
            bullet_id: s.b1.id,
            parent_id: null,
            position: null,
            proposed_text: rejected.proposedText,
            rationale: rejected.rationale,
            status: 'rejected',
          },
          {
            suggestion_id: add.id,
            kind: 'add',
            bullet_id: null,
            parent_id: s.exp.id,
            position: 2,
            proposed_text: 'Mentored two engineers',
            rationale: add.rationale,
            status: 'pending',
          },
        ],
      });
    } finally {
      await s.cleanup();
    }
  },
);

test('a named resume of his own is read the same way', { skip }, async () => {
  const s = await setup();
  try {
    const result = await getResume.call({ userId: s.user.id }, { resume_id: s.own.id });
    assert.equal(result.isError, undefined, text(result));
    const body = JSON.parse(text(result)) as { resume_id: string; is_default: boolean };
    assert.equal(body.resume_id, s.own.id);
    assert.equal(body.is_default, false);
  } finally {
    await s.cleanup();
  }
});

test(
  "an application's resume, and an unknown one, say what to call instead",
  { skip },
  async () => {
    const s = await setup();
    try {
      const tailored = await getResume.call({ userId: s.user.id }, { resume_id: s.tailored.id });
      assert.equal(tailored.isError, true);
      assert.match(text(tailored), new RegExp(`application \\(${s.app.id}\\)`));
      assert.match(text(tailored), /set_resume_selection and suggest_bullet/);

      const unknown = randomUUID();
      const missing = await getResume.call({ userId: s.user.id }, { resume_id: unknown });
      assert.equal(missing.isError, true);
      assert.equal(text(missing), `No resume ${unknown}. Call list_resumes to find its resume_id.`);
    } finally {
      await s.cleanup();
    }
  },
);
