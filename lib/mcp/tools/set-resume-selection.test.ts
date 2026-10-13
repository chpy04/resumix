/**
 * `set_resume_selection` against a real database, with the LaTeX sidecar
 * stubbed at `fetch`, as `lib/feedback/github.test.ts` stubs GitHub. CI's
 * test job has no sidecar, and the page count is the thing under test, so
 * the stub is what lets each test choose it.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let setResumeSelection: typeof import('./set-resume-selection.ts').setResumeSelection;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let getSelections: typeof import('../../queries/selections.ts').getSelections;
let toSelections: typeof import('../selection.ts').toSelections;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ setResumeSelection } = await import('./set-resume-selection.ts'));
  ({ getApplicationRow } = await import('../../queries/applications.ts'));
  ({ getSelections } = await import('../../queries/selections.ts'));
  ({ toSelections } = await import('../selection.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

type CompileReply = { ok: boolean; pages: number | null; errors?: string[] } | Error;

/** Points `compileTex` at a fake sidecar that answers `reply`, recording
 *  every `.tex` it is sent. */
function stubLatex(reply: CompileReply): { sent: string[]; restore: () => void } {
  const sent: string[] = [];
  const original = { fetch: globalThis.fetch, url: process.env.LATEX_SERVICE_URL };
  process.env.LATEX_SERVICE_URL = 'http://latex.test';

  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    assert.equal(String(input), 'http://latex.test/compile');
    sent.push((JSON.parse(String(init.body)) as { tex: string }).tex);
    if (reply instanceof Error) throw reply;
    return Response.json({
      ...(reply.ok ? { pdfBase64: 'JVBERi0xLjUK' } : {}),
      errors: [],
      log: '',
      durationMs: 1,
      ...reply,
    });
  }) as typeof fetch;

  return {
    sent,
    restore: () => {
      globalThis.fetch = original.fetch;
      if (original.url === undefined) delete process.env.LATEX_SERVICE_URL;
      else process.env.LATEX_SERVICE_URL = original.url;
    },
  };
}

/** A fresh account with live and archived content, and one application in
 *  `status` with a resume of its own. */
async function setup(status: ApplicationStatus = 'proposing') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`sel-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const first = await fixtures.insertExperienceBullet(exp.id, 'First bullet');
  const second = await fixtures.insertExperienceBullet(exp.id, 'Second \\textbf{bold} bullet');
  const archived = await fixtures.insertExperienceBullet(exp.id, 'Archived bullet', true);
  const other = await fixtures.insertExperience(user.id, `${tag}-other`);
  const otherBullet = await fixtures.insertExperienceBullet(other.id, 'Other bullet');
  const project = await fixtures.insertProject(user.id, tag);
  const projectBullet = await fixtures.insertProjectBullet(project.id, 'Built it');
  const row = await fixtures.insertSkillRow(user.id, tag);
  const skill = await fixtures.insertSkill(row.id, 'TypeScript');
  const resume = await fixtures.insertTestResume(user.id, tag);
  const app = await fixtures.insertTestApplication(user.id, tag, { status, resumeId: resume.id });

  const selection = {
    experiences: [exp.id],
    experience_bullets: { [exp.id]: [second.id, first.id] },
    projects: [project.id],
    project_bullets: { [project.id]: [projectBullet.id] },
    skill_rows: [row.id],
    skills: { [row.id]: [skill.id] },
  };

  return {
    user,
    exp,
    first,
    second,
    archived,
    other,
    otherBullet,
    resume,
    app,
    selection,
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
    },
  };
}

async function call(userId: string, applicationId: string, selection: unknown) {
  return setResumeSelection.call({ userId }, { application_id: applicationId, selection });
}

function json(result: { content: { text: string }[] }): unknown {
  return JSON.parse(result.content[0]?.text ?? '');
}

test('writes all six slices, renders them, and answers ok on one page', { skip }, async () => {
  const s = await setup();
  const latex = stubLatex({ ok: true, pages: 1 });
  try {
    const result = await call(s.user.id, s.app.id, s.selection);
    assert.equal(result.isError, undefined, result.content[0]?.text);
    assert.deepEqual(json(result), { ok: true, pages: 1, overflow: null });

    assert.deepEqual(await getSelections(s.resume.id), toSelections(s.selection));
    // What was compiled is that selection, its content raw (D-008).
    assert.equal(latex.sent.length, 1);
    assert.ok(latex.sent[0]?.includes('Second \\textbf{bold} bullet'));
    assert.ok(latex.sent[0]?.includes('TypeScript'));
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test(
  'while proposing it records proposed_selection, each call replacing the last',
  { skip },
  async () => {
    const s = await setup('proposing');
    const latex = stubLatex({ ok: true, pages: 1 });
    try {
      await call(s.user.id, s.app.id, s.selection);
      const trimmed = { ...s.selection, experience_bullets: { [s.exp.id]: [s.first.id] } };
      await call(s.user.id, s.app.id, trimmed);

      const row = await getApplicationRow(s.user.id, s.app.id);
      assert.deepEqual(row?.proposedSelection, toSelections(trimmed));
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test(
  'outside proposing the selection is written but proposed_selection is not, and ready reopens',
  { skip },
  async () => {
    const latex = stubLatex({ ok: true, pages: 1 });
    try {
      for (const status of ['draft', 'needs_review', 'ready'] as const) {
        const s = await setup(status);
        try {
          const result = await call(s.user.id, s.app.id, s.selection);
          assert.equal(result.isError, undefined, `${status}: ${result.content[0]?.text}`);
          assert.deepEqual(await getSelections(s.resume.id), toSelections(s.selection));
          const row = await getApplicationRow(s.user.id, s.app.id);
          assert.equal(row?.proposedSelection, null, status);
          // An edit to a ready application reopens it, as any selection
          // write does (C3, D-044); the tool itself never sets a status.
          assert.equal(row?.status, status === 'ready' ? 'needs_review' : status, status);
        } finally {
          await s.cleanup();
        }
      }
    } finally {
      latex.restore();
    }
  },
);

test(
  'archived, foreign and unselected-parent ids are refused and nothing is written',
  { skip },
  async () => {
    const s = await setup();
    const bob = await fixtures.insertUser(`sel-bob-${fixtures.testTag()}`);
    const bobExp = await fixtures.insertExperience(bob.id, 'bob');
    const latex = stubLatex({ ok: true, pages: 1 });
    try {
      await call(s.user.id, s.app.id, s.selection);
      const before = await getSelections(s.resume.id);
      latex.sent.length = 0;

      const attempts: [unknown, string][] = [
        [
          { ...s.selection, experience_bullets: { [s.exp.id]: [s.first.id, s.archived.id] } },
          s.archived.id,
        ],
        [{ ...s.selection, experiences: [s.exp.id, bobExp.id] }, bobExp.id],
        [
          {
            ...s.selection,
            experience_bullets: {
              ...s.selection.experience_bullets,
              [s.other.id]: [s.otherBullet.id],
            },
          },
          s.other.id,
        ],
      ];
      for (const [selection, named] of attempts) {
        const result = await call(s.user.id, s.app.id, selection);
        assert.equal(result.isError, true);
        const text = result.content[0]?.text ?? '';
        assert.match(text, /^Nothing was written: /);
        assert.match(text, /Call get_library for current ids/);
        assert.ok(text.includes(named), `${text} should name ${named}`);
      }

      assert.deepEqual(await getSelections(s.resume.id), before);
      assert.deepEqual(
        (await getApplicationRow(s.user.id, s.app.id))?.proposedSelection,
        toSelections(s.selection),
      );
      assert.equal(latex.sent.length, 0, 'nothing was compiled');
    } finally {
      latex.restore();
      await s.cleanup();
    }
  },
);

test(
  'a sent, unlinked, Default-linked, unknown or foreign application is refused',
  { skip },
  async () => {
    const s = await setup();
    const sent = await fixtures.insertTestApplication(s.user.id, 'sent', {
      status: 'applied',
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
    const bob = await fixtures.insertUser(`sel-bob-${fixtures.testTag()}`);
    const bobs = await fixtures.insertTestApplication(bob.id, 'bob', { status: 'proposing' });
    const latex = stubLatex({ ok: true, pages: 1 });
    try {
      const defaultBefore = await getSelections(defaultResume.id);
      const resumeBefore = await getSelections(s.resume.id);
      const cases: [string, RegExp][] = [
        [
          sent.id,
          /^This application is applied: it has been sent.*Nothing was written\. Leave it as it is, and call list_applications/,
        ],
        [
          unlinked.id,
          /has no resume to select into\. Nothing was written; ask Chris to link one\./,
        ],
        [onDefault.id, /linked to the Default resume.*Nothing was written; ask Chris/],
        [bobs.id, /^No application .*Call list_applications/],
        [randomUUID(), /^No application .*Call list_applications/],
      ];
      for (const [id, message] of cases) {
        const result = await call(s.user.id, id, s.selection);
        assert.equal(result.isError, true, id);
        assert.match(result.content[0]?.text ?? '', message);
      }

      assert.deepEqual(await getSelections(defaultResume.id), defaultBefore);
      assert.deepEqual(await getSelections(s.resume.id), resumeBefore);
      assert.equal(latex.sent.length, 0);
    } finally {
      latex.restore();
      for (const a of [sent, unlinked, onDefault, bobs]) await fixtures.deleteApplicationRow(a.id);
      await s.cleanup();
    }
  },
);

test('two pages is ok:false, with bullets to drop', { skip }, async () => {
  const s = await setup();
  const latex = stubLatex({ ok: true, pages: 2 });
  try {
    const result = await call(s.user.id, s.app.id, s.selection);
    assert.equal(result.isError, undefined, result.content[0]?.text);
    const body = json(result) as {
      ok: boolean;
      pages: number;
      overflow: { candidates: { id: string; text: string }[]; advice: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.pages, 2);
    // The project's only bullet is not offered; the experience's last one is.
    assert.deepEqual(
      body.overflow.candidates.map((c) => c.id),
      [s.first.id, s.second.id],
    );
    assert.equal(body.overflow.candidates[1]?.text, 'Second bold bullet');
    assert.match(body.overflow.advice, new RegExp(`^2 pages: .*Try ${s.first.id} first`));
    // Saved anyway: the next move is to trim it.
    assert.deepEqual(await getSelections(s.resume.id), toSelections(s.selection));
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a LaTeX error is isError, with the selection saved', { skip }, async () => {
  const s = await setup();
  const latex = stubLatex({
    ok: false,
    pages: null,
    errors: ['! Undefined control sequence. l.42', '! Missing } inserted.', '! a', '! b'],
  });
  try {
    const result = await call(s.user.id, s.app.id, s.selection);
    assert.equal(result.isError, true);
    const text = result.content[0]?.text ?? '';
    assert.match(text, /^Saved, but it does not compile: ! Undefined control sequence\. l\.42/);
    assert.ok(text.includes('! a') && !text.includes('! b'), 'the first three errors only');
    assert.deepEqual(await getSelections(s.resume.id), toSelections(s.selection));
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('an unreachable sidecar is isError, with the selection saved', { skip }, async () => {
  const s = await setup();
  const latex = stubLatex(new TypeError('fetch failed'));
  try {
    const result = await call(s.user.id, s.app.id, s.selection);
    assert.equal(result.isError, true);
    assert.match(
      result.content[0]?.text ?? '',
      /^The selection was saved, but Resumix could not compile it \(Could not reach the latex service.*Call again with the same arguments/,
    );
    assert.deepEqual(await getSelections(s.resume.id), toSelections(s.selection));
  } finally {
    latex.restore();
    await s.cleanup();
  }
});

test('a selection missing a slice is refused by the schema', { skip }, async () => {
  const s = await setup();
  try {
    const { skills: _, ...missing } = s.selection;
    const result = await call(s.user.id, s.app.id, missing);
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? '', /^Invalid arguments: selection\.skills/);
    assert.deepEqual((await getSelections(s.resume.id)).experiences, []);
  } finally {
    await s.cleanup();
  }
});
