/**
 * `edit_resume_selection` against a real database, with the sidecar stubbed
 * at `fetch` (`stubLatex`): Chris's own resume takes the selection at once,
 * with no review, and its pages are counted with his pending suggestions laid
 * over it (D-054). A refused call writes and compiles nothing.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let editResumeSelection: typeof import('./edit-resume-selection.ts').editResumeSelection;
let getSelections: typeof import('../../queries/selections.ts').getSelections;
let setup: typeof import('./resume-tools.fixture.ts').resumeToolsSetup;
let text: typeof import('./resume-tools.fixture.ts').text;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ editResumeSelection } = await import('./edit-resume-selection.ts'));
  ({ getSelections } = await import('../../queries/selections.ts'));
  ({ resumeToolsSetup: setup, text } = await import('./resume-tools.fixture.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

/** Every bullet, reordered: what "lead with the migration" asks for. */
function reordered(s: Awaited<ReturnType<typeof setup>>) {
  return {
    experiences: [s.exp.id],
    experience_bullets: { [s.exp.id]: [s.b3.id, s.b1.id, s.b2.id] },
    projects: [],
    project_bullets: {},
    skill_rows: [],
    skills: {},
  };
}

test('with no resume named, Default takes the selection at once', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await editResumeSelection.call(
      { userId: s.user.id },
      { selection: reordered(s) },
    );
    assert.equal(result.isError, undefined, text(result));
    assert.deepEqual(JSON.parse(text(result)), {
      resume_id: s.defaultResume.id,
      ok: true,
      pages: 1,
      overflow: null,
    });
    assert.deepEqual((await getSelections(s.defaultResume.id)).experienceBullets, {
      [s.exp.id]: [s.b3.id, s.b1.id, s.b2.id],
    });
    // Only Default moved.
    assert.deepEqual((await getSelections(s.own.id)).experienceBullets, {
      [s.exp.id]: [s.b3.id],
    });
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('the page count is the one the editor preview will show', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 2);
  try {
    await fixtures.insertResumeSuggestion(s.own.id, {
      bulletId: s.b3.id,
      proposedText: 'Led a zero-downtime migration',
    });
    const result = await editResumeSelection.call(
      { userId: s.user.id },
      { resume_id: s.own.id, selection: reordered(s) },
    );
    const body = JSON.parse(text(result)) as { ok: boolean; pages: number; overflow: unknown };
    assert.equal(body.ok, false);
    assert.equal(body.pages, 2);
    assert.notEqual(body.overflow, null);
    assert.ok(latex.sent[0]?.includes('Led a zero-downtime migration'));
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test("an application's resume and unknown ids are refused, writing nothing", { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const before = await s.state();
    const tailored = await editResumeSelection.call(
      { userId: s.user.id },
      { resume_id: s.tailored.id, selection: reordered(s) },
    );
    assert.equal(tailored.isError, true);
    assert.match(text(tailored), /set_resume_selection and suggest_bullet/);

    const unknown = randomUUID();
    const bad = await editResumeSelection.call(
      { userId: s.user.id },
      { selection: { ...reordered(s), experiences: [unknown] } },
    );
    assert.equal(bad.isError, true);
    assert.match(text(bad), /^Nothing was written: /);

    assert.deepEqual(await s.state(), before);
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});
