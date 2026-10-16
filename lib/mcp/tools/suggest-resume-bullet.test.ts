/**
 * `suggest_resume_bullet` against a real database, with the sidecar stubbed
 * at `fetch` (`stubLatex`): a suggestion on Chris's own resume is recorded
 * for him to review in its editor, and never written to the library or the
 * resume (D-054). The checks themselves are `suggest_bullet`'s, tested there.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let suggestResumeBullet: typeof import('./suggest-resume-bullet.ts').suggestResumeBullet;
let setup: typeof import('./resume-tools.fixture.ts').resumeToolsSetup;
let text: typeof import('./resume-tools.fixture.ts').text;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ suggestResumeBullet } = await import('./suggest-resume-bullet.ts'));
  ({ resumeToolsSetup: setup, text } = await import('./resume-tools.fixture.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const WHY = 'Chris asked for numbers';

test(
  'with no resume named, an edit on Default is recorded, compiled, and writes nothing else',
  { skip },
  async () => {
    const s = await setup();
    const latex = fixtures.stubLatex(() => 1);
    try {
      const before = await s.state();
      const result = await suggestResumeBullet.call(
        { userId: s.user.id },
        {
          kind: 'edit',
          bullet_id: s.b1.id,
          proposed_text: 'Cut p99 latency 40% across 3 services',
          rationale: WHY,
        },
      );
      assert.equal(result.isError, undefined, text(result));
      const [saved] = await s.suggestions();
      assert.deepEqual(JSON.parse(text(result)), {
        resume_id: s.defaultResume.id,
        suggestion_id: saved?.id,
        kind: 'edit',
        replaced: false,
        ok: true,
        pages: 1,
        editor_path: `/resume/${s.defaultResume.id}`,
      });
      assert.equal(saved?.status, 'pending');
      assert.deepEqual(await s.state(), before);
      assert.ok(latex.sent[0]?.includes('\\resumeItem{Cut p99 latency 40\\% across 3 services}'));
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('a second edit of the bullet replaces the pending one', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const args = { resume_id: s.own.id, kind: 'edit', bullet_id: s.b3.id, rationale: WHY };
    await suggestResumeBullet.call({ userId: s.user.id }, { ...args, proposed_text: 'First try' });
    const second = await suggestResumeBullet.call(
      { userId: s.user.id },
      { ...args, proposed_text: 'Second try' },
    );
    assert.equal((JSON.parse(text(second)) as { replaced: boolean }).replaced, true);
    assert.deepEqual(
      (await s.suggestions(s.own.id)).map((x) => x.proposedText),
      ['Second try'],
    );
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an add lands in its slot on the resume it names', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const result = await suggestResumeBullet.call(
      { userId: s.user.id },
      {
        resume_id: s.own.id,
        kind: 'add',
        parent_id: s.exp.id,
        position: 0,
        proposed_text: 'Mentored two engineers',
        rationale: WHY,
      },
    );
    assert.equal(result.isError, undefined, text(result));
    const [saved] = await s.suggestions(s.own.id);
    assert.equal(saved?.kind, 'add');
    assert.equal(saved?.position, 0);
    assert.deepEqual(await s.suggestions(), [], 'Default has none');
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a refusal names this tool family and writes and compiles nothing', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const before = await s.state();
    // b3 is not on Default: the way to put it there is edit_resume_selection.
    const notShown = await suggestResumeBullet.call(
      { userId: s.user.id },
      { kind: 'edit', bullet_id: s.b3.id, proposed_text: 'Led it', rationale: WHY },
    );
    assert.equal(notShown.isError, true);
    assert.match(text(notShown), /is not on this resume/);
    assert.match(text(notShown), /edit_resume_selection/);

    const tailored = await suggestResumeBullet.call(
      { userId: s.user.id },
      {
        resume_id: s.tailored.id,
        kind: 'edit',
        bullet_id: s.b1.id,
        proposed_text: 'Led it',
        rationale: WHY,
      },
    );
    assert.equal(tailored.isError, true);
    assert.match(text(tailored), /suggest_bullet/);

    assert.deepEqual(await s.state(), before);
    assert.deepEqual(await s.suggestions(), []);
    assert.equal(latex.sent.length, 0);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});
