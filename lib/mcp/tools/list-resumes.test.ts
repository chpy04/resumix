/**
 * `list_resumes` against a real database: Chris's own resumes, Default
 * first, and never one an application is tailored on (D-054).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let listResumes: typeof import('./list-resumes.ts').listResumes;
let setup: typeof import('./resume-tools.fixture.ts').resumeToolsSetup;
let text: typeof import('./resume-tools.fixture.ts').text;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ listResumes } = await import('./list-resumes.ts'));
  ({ resumeToolsSetup: setup, text } = await import('./resume-tools.fixture.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

test("lists Default, then Chris's own resumes, never an application's", { skip }, async () => {
  const s = await setup();
  try {
    const result = await listResumes.call({ userId: s.user.id }, {});
    assert.equal(result.isError, undefined, text(result));
    assert.deepEqual(JSON.parse(text(result)), [
      { resume_id: s.defaultResume.id, name: s.defaultResume.name, is_default: true },
      { resume_id: s.own.id, name: s.own.name, is_default: false },
    ]);
  } finally {
    await s.cleanup();
  }
});
