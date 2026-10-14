/**
 * `suggest_bullet` against a real database, with the sidecar stubbed at
 * `fetch` (`stubLatex`): the page count it answers comes from a compile with
 * the suggestions laid over the resume (D-045). Whatever it answers, it
 * never writes a bullet or a selection.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let suggestBullet: typeof import('./suggest-bullet.ts').suggestBullet;
let setResumeSelection: typeof import('./set-resume-selection.ts').setResumeSelection;
let listBulletSuggestions: typeof import('../../queries/bullet-suggestions.ts').listBulletSuggestions;
let assembleLibrary: typeof import('../../queries/library.ts').assembleLibrary;
let getSelections: typeof import('../../queries/selections.ts').getSelections;
let replaceSelections: typeof import('../../queries/selections.ts').replaceSelections;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ suggestBullet } = await import('./suggest-bullet.ts'));
  ({ setResumeSelection } = await import('./set-resume-selection.ts'));
  ({ listBulletSuggestions } = await import('../../queries/bullet-suggestions.ts'));
  ({ assembleLibrary } = await import('../../queries/library.ts'));
  ({ getSelections, replaceSelections } = await import('../../queries/selections.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

/** A fresh account: an experience showing two of its three bullets, a
 *  project showing its one, an experience the resume leaves out, and an
 *  application in `status` with that resume. */
async function setup(status: ApplicationStatus = 'proposing') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`suggest-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const b1 = await fixtures.insertExperienceBullet(exp.id, 'Cut latency \\textbf{40\\%}');
  const b2 = await fixtures.insertExperienceBullet(exp.id, 'Shipped tooling');
  const b3 = await fixtures.insertExperienceBullet(exp.id, 'Led a migration');
  const archived = await fixtures.insertExperienceBullet(exp.id, 'Old news', true);
  const left = await fixtures.insertExperience(user.id, `${tag}-left`);
  const project = await fixtures.insertProject(user.id, tag);
  const p1 = await fixtures.insertProjectBullet(project.id, 'Built it');
  const resume = await fixtures.insertTestResume(user.id, tag);
  await replaceSelections(user.id, resume.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id, b2.id, archived.id] },
    projects: [project.id],
    projectBullets: { [project.id]: [p1.id] },
  });
  const app = await fixtures.insertTestApplication(user.id, tag, { status, resumeId: resume.id });

  return {
    user,
    exp,
    b1,
    b2,
    b3,
    archived,
    left,
    project,
    p1,
    resume,
    app,
    /** The library and the selection, to prove neither moved. */
    async state() {
      return {
        library: await assembleLibrary(user.id, true),
        selections: await getSelections(resume.id),
      };
    },
    suggestions: () => listBulletSuggestions(user.id, app.id),
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
    },
  };
}

function call(userId: string, args: Record<string, unknown>) {
  return suggestBullet.call({ userId }, args);
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

const WHY = 'The posting stresses scale';

test(
  'an edit is recorded, compiled with its text, and writes no library row',
  { skip },
  async () => {
    const s = await setup();
    const latex = fixtures.stubLatex(() => 1);
    try {
      const before = await s.state();
      const result = await call(s.user.id, {
        application_id: s.app.id,
        kind: 'edit',
        bullet_id: s.b1.id,
        proposed_text: 'Cut p99 latency 40% across 3 services',
        rationale: WHY,
      });
      assert.equal(result.isError, undefined, text(result));
      const [saved] = await s.suggestions();
      assert.deepEqual(JSON.parse(text(result)), {
        suggestion_id: saved?.id,
        kind: 'edit',
        replaced: false,
        ok: true,
        pages: 1,
      });
      assert.equal(saved?.bulletKind, 'experience');
      assert.equal(saved?.status, 'pending');
      assert.deepEqual(await s.state(), before);
      // The compile saw the suggestion, escaped, in place of the bullet.
      assert.equal(latex.sent.length, 1);
      assert.ok(latex.sent[0]?.includes('\\resumeItem{Cut p99 latency 40\\% across 3 services}'));
      assert.ok(!latex.sent[0]?.includes('\\textbf{40\\%}'));
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test(
  "an add under a project resolves the project's kind, and lands at its slot",
  { skip },
  async () => {
    const s = await setup();
    const latex = fixtures.stubLatex(() => 1);
    try {
      const before = await s.state();
      const result = await call(s.user.id, {
        application_id: s.app.id,
        kind: 'add',
        parent_id: s.project.id,
        position: 0,
        proposed_text: 'Wrote the docs',
        rationale: WHY,
      });
      assert.equal(result.isError, undefined, text(result));
      const [saved] = await s.suggestions();
      assert.equal(saved?.bulletKind, 'project');
      assert.equal(saved?.position, 0);
      assert.deepEqual(await s.state(), before);
      const tex = latex.sent[0] ?? '';
      assert.ok(tex.indexOf('{Wrote the docs}') < tex.indexOf('{Built it}'));
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test('a second edit of a bullet replaces the pending one', { skip }, async () => {
  const s = await setup();
  const latex = fixtures.stubLatex(() => 1);
  try {
    const edit = (proposed_text: string) =>
      call(s.user.id, {
        application_id: s.app.id,
        kind: 'edit',
        bullet_id: s.b2.id,
        proposed_text,
        rationale: WHY,
      });
    const first = JSON.parse(text(await edit('Shipped 3 tools'))) as Record<string, unknown>;
    const second = JSON.parse(text(await edit('Shipped 4 tools'))) as Record<string, unknown>;
    assert.equal(first.replaced, false);
    assert.equal(second.replaced, true);
    assert.equal(second.suggestion_id, first.suggestion_id);
    const rows = await s.suggestions();
    assert.deepEqual(
      rows.map((r) => r.proposedText),
      ['Shipped 4 tools'],
    );
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('pages counts the resume with every pending suggestion laid over it', { skip }, async () => {
  const s = await setup();
  // Two pages exactly when the compile includes the suggestion.
  const latex = fixtures.stubLatex((tex) => (tex.includes('Ran on-call for a year') ? 2 : 1));
  try {
    const result = await call(s.user.id, {
      application_id: s.app.id,
      kind: 'add',
      parent_id: s.exp.id,
      position: 2,
      proposed_text: 'Ran on-call for a year',
      rationale: WHY,
    });
    assert.equal(result.isError, undefined, text(result));
    const body = JSON.parse(text(result)) as { ok: boolean; pages: number };
    assert.equal(body.ok, false);
    assert.equal(body.pages, 2);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('every refusal says what to do, and writes and compiles nothing', { skip }, async () => {
  const s = await setup();
  const inReview = await fixtures.insertTestApplication(s.user.id, 'review', {
    status: 'needs_review',
    resumeId: s.resume.id,
  });
  const unlinked = await fixtures.insertTestApplication(s.user.id, 'unlinked', {
    status: 'proposing',
  });
  const defaultResume = await fixtures.getDefaultResumeRow(s.user.id);
  const onDefault = await fixtures.insertTestApplication(s.user.id, 'default', {
    status: 'proposing',
    resumeId: defaultResume.id,
  });
  const bob = await fixtures.insertUser(`suggest-bob-${fixtures.testTag()}`);
  const bobs = await fixtures.insertTestApplication(bob.id, 'bob', { status: 'proposing' });
  // One pending add, which a second identical one must not duplicate.
  const pending = await fixtures.insertBulletSuggestion(s.app.id, {
    kind: 'add',
    parentId: s.exp.id,
    position: 0,
    proposedText: 'Ran on-call',
  });
  const latex = fixtures.stubLatex(() => 1);
  try {
    const before = await s.state();
    const edit = (bullet_id: string, proposed_text = 'Something new') => ({
      application_id: s.app.id,
      kind: 'edit',
      bullet_id,
      proposed_text,
      rationale: WHY,
    });
    const add = (parent_id: string, position: number, proposed_text = 'Something new') => ({
      application_id: s.app.id,
      kind: 'add',
      parent_id,
      position,
      proposed_text,
      rationale: WHY,
    });
    const unknown = randomUUID();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...edit(s.b1.id), application_id: unknown }, /^No application .*Call list_applications/],
      [{ ...edit(s.b1.id), application_id: bobs.id }, /^No application .*Call list_applications/],
      [
        { ...edit(s.b1.id), application_id: inReview.id },
        /^This application is needs_review; suggestions can only be made while it is proposing\. Nothing was written\. Put anything else you'd change in your reply to Chris\.$/,
      ],
      [
        { ...edit(s.b1.id), application_id: unlinked.id },
        /has no resume to suggest bullets for\. Nothing was written; ask Chris to link one\./,
      ],
      [
        { ...edit(s.b1.id), application_id: onDefault.id },
        /linked to the Default resume.*Nothing was written; ask Chris/,
      ],
      [edit(unknown), new RegExp(`^No bullet ${unknown} in the library\\. .*call get_library`)],
      // Archived reads as unknown: the agent only ever sees live content.
      [edit(s.archived.id), /^No bullet .* in the library/],
      [
        edit(s.b3.id),
        /is not on this application's resume.*Select it with set_resume_selection first, or suggest an add\./,
      ],
      [
        edit(s.b1.id, 'cut latency 40%'),
        /^That is the bullet's current text\. Nothing was written\.$/,
      ],
      [add(unknown, 0), /^No experience or project .* in the library\. .*call get_library/],
      [
        add(s.left.id, 0),
        /^That experience .* is not on this application's resume\..*set_resume_selection first/,
      ],
      [
        add(s.exp.id, 4),
        /^position 4 is past the end: that experience shows 3 bullet\(s\), so 0 puts it first and 3 last\./,
      ],
      [
        add(s.exp.id, 0, 'Led a migration'),
        new RegExp(`^That is bullet ${s.b3.id}'s text already\\. .*select ${s.b3.id}`),
      ],
      [
        add(s.exp.id, 1, 'Ran on-call'),
        new RegExp(`^You already suggested that: ${pending.id}\\.`),
      ],
      [{ ...edit(s.b1.id), parent_id: s.exp.id }, /^Invalid arguments: parent_id: is for an add/],
      [
        { ...add(s.exp.id, 0), bullet_id: s.b1.id },
        /^Invalid arguments: bullet_id: is for an edit/,
      ],
      [
        { ...edit(s.b1.id), proposed_text: 'Cut \\textbf{latency}' },
        /^Invalid arguments: proposed_text: plain text: write it as it should read, without LaTeX/,
      ],
    ];
    for (const [args, message] of cases) {
      const result = await call(s.user.id, args);
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match(text(result), message);
    }

    assert.deepEqual(await s.state(), before);
    assert.deepEqual(
      (await s.suggestions()).map((r) => r.id),
      [pending.id],
    );
    assert.deepEqual(await listBulletSuggestions(s.user.id, inReview.id), []);
    assert.equal(latex.sent.length, 0, 'nothing was compiled');
  } finally {
    latex.restore();
    for (const a of [inReview, unlinked, onDefault, bobs])
      await fixtures.deleteApplicationRow(a.id);
    await s.cleanup();
  }
});

test(
  'a LaTeX error or an unreachable sidecar is isError, with the suggestion saved',
  { skip },
  async () => {
    const s = await setup();
    try {
      const answers: ['error' | 'down', RegExp][] = [
        [
          'error',
          /^The suggestion was saved as .*, but the resume no longer compiles with it: ! Undefined control sequence.*Stop and tell Chris\.$/,
        ],
        [
          'down',
          /^The suggestion was saved as .*, but Resumix could not compile the resume to count its pages \(Could not reach the latex service.*submit_for_review counts the pages again/,
        ],
      ];
      for (const [answer, message] of answers) {
        const latex = fixtures.stubLatex(() => answer);
        try {
          const result = await call(s.user.id, {
            application_id: s.app.id,
            kind: 'edit',
            bullet_id: s.b2.id,
            proposed_text: `Shipped tooling, ${answer}`,
            rationale: WHY,
          });
          assert.equal(result.isError, true);
          assert.match(text(result), message);
          const [saved] = await s.suggestions();
          assert.ok(text(result).includes(saved?.id ?? 'missing'));
          assert.equal(saved?.proposedText, `Shipped tooling, ${answer}`);
        } finally {
          latex.restore();
        }
      }
    } finally {
      await s.cleanup();
    }
  },
);

test('set_resume_selection counts pages with the pending suggestions too', { skip }, async () => {
  const s = await setup();
  await fixtures.insertBulletSuggestion(s.app.id, {
    kind: 'add',
    parentId: s.exp.id,
    position: 0,
    proposedText: 'Ran on-call for a year',
  });
  const latex = fixtures.stubLatex((tex) => (tex.includes('Ran on-call for a year') ? 2 : 1));
  try {
    const result = await setResumeSelection.call(
      { userId: s.user.id },
      {
        application_id: s.app.id,
        selection: {
          experiences: [s.exp.id],
          experience_bullets: { [s.exp.id]: [s.b1.id, s.b2.id] },
          projects: [],
          project_bullets: {},
          skill_rows: [],
          skills: {},
        },
      },
    );
    assert.equal(result.isError, undefined, text(result));
    assert.equal((JSON.parse(text(result)) as { pages: number }).pages, 2);
  } finally {
    latex.restore();
    await s.cleanup();
  }
});
