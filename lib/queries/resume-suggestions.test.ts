/**
 * Bullet suggestions on one of Chris's own resumes, outside any application,
 * against a real database (D-054): what the table refuses, that recording
 * one writes nothing else, and what each of his actions does in that
 * resume's editor, where no application status gates them.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let createResumeSuggestion: typeof import('./bullet-suggestions.ts').createResumeSuggestion;
let listResumeSuggestions: typeof import('./bullet-suggestions.ts').listResumeSuggestions;
let pendingResumeSuggestions: typeof import('./bullet-suggestions.ts').pendingResumeSuggestions;
let resolveBulletSuggestion: typeof import('./bullet-suggestions.ts').resolveBulletSuggestion;
let updateBulletSuggestionText: typeof import('./bullet-suggestions.ts').updateBulletSuggestionText;
let assembleLibrary: typeof import('./library.ts').assembleLibrary;
let renderResumeById: typeof import('./render.ts').renderResumeById;
let findApplicationUsingResume: typeof import('./resumes.ts').findApplicationUsingResume;
let getResumeDetail: typeof import('./resumes.ts').getResumeDetail;
let listStandaloneResumes: typeof import('./resumes.ts').listStandaloneResumes;
let getSelections: typeof import('./selections.ts').getSelections;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError } = await import('./errors.ts'));
  ({
    createResumeSuggestion,
    listResumeSuggestions,
    pendingResumeSuggestions,
    resolveBulletSuggestion,
    updateBulletSuggestionText,
  } = await import('./bullet-suggestions.ts'));
  ({ assembleLibrary } = await import('./library.ts'));
  ({ renderResumeById } = await import('./render.ts'));
  ({ findApplicationUsingResume, getResumeDetail, listStandaloneResumes } = await import(
    './resumes.ts'
  ));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const BOLD = 'Cut latency \\textbf{40\\%}';

/** A fresh account: one experience with three bullets, two of them on a
 *  resume of Chris's own, and a second resume that an application is
 *  tailored on, which shows the first bullet too, to prove Apply is global. */
async function setup() {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`rsugg-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const b1 = await fixtures.insertExperienceBullet(exp.id, BOLD);
  const b2 = await fixtures.insertExperienceBullet(exp.id, 'Shipped tooling');
  const b3 = await fixtures.insertExperienceBullet(exp.id, 'Led a migration');
  const own = await fixtures.insertTestResume(user.id, tag);
  await replaceSelections(user.id, own.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id, b2.id] },
  });
  const tailored = await fixtures.insertTestResume(user.id, `${tag}-app`);
  await replaceSelections(user.id, tailored.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id] },
  });
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status: 'needs_review',
    resumeId: tailored.id,
  });

  return {
    user,
    exp,
    b1,
    b2,
    b3,
    own,
    tailored,
    app,
    async bulletText(id: string) {
      const library = await assembleLibrary(user.id, true);
      return library.experiences.flatMap((e) => e.bullets).find((b) => b.id === id)?.content;
    },
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(own.id);
      await fixtures.deleteResumeRow(tailored.id);
    },
  };
}

/** The driver's error, under drizzle's wrapper. */
function violates(constraint: string) {
  return (error: unknown) =>
    (error as { cause?: { constraint_name?: string } }).cause?.constraint_name === constraint;
}

const EDIT = (bulletId: string, proposedText = 'Cut p99 latency 40%') => ({
  kind: 'edit' as const,
  bulletKind: 'experience' as const,
  bulletId,
  proposedText,
  rationale: 'Chris asked for numbers',
});

test('a suggestion belongs to exactly one of an application and a resume', { skip }, async () => {
  const s = await setup();
  try {
    await assert.rejects(
      () =>
        fixtures.insertResumeSuggestion(s.own.id, { applicationId: s.app.id, bulletId: s.b1.id }),
      violates('ck_bullet_suggestion_owner'),
    );
    await assert.rejects(
      () => fixtures.insertResumeSuggestion(s.own.id, { resumeId: null, bulletId: s.b1.id }),
      violates('ck_bullet_suggestion_owner'),
    );
    // One pending edit per bullet per resume, as per application.
    await fixtures.insertResumeSuggestion(s.own.id, { bulletId: s.b1.id });
    await assert.rejects(
      () => fixtures.insertResumeSuggestion(s.own.id, { bulletId: s.b1.id }),
      violates('ux_bullet_suggestion_pending_resume_edit'),
    );
  } finally {
    await s.cleanup();
  }
});

test(
  'recording one writes nothing else, and a second edit of the bullet replaces it',
  { skip },
  async () => {
    const s = await setup();
    try {
      const selectionsBefore = await getSelections(s.own.id);
      const first = await createResumeSuggestion(s.user.id, s.own.id, EDIT(s.b1.id));
      assert.equal(first.replaced, false);
      assert.equal(first.suggestion.status, 'pending');
      assert.equal(await s.bulletText(s.b1.id), BOLD);
      assert.deepEqual(await getSelections(s.own.id), selectionsBefore);

      const second = await createResumeSuggestion(
        s.user.id,
        s.own.id,
        EDIT(s.b1.id, 'Cut p99 latency 40% across 3 services'),
      );
      assert.equal(second.replaced, true);
      assert.equal(second.suggestion.id, first.suggestion.id);
      const listed = await listResumeSuggestions(s.user.id, s.own.id);
      assert.deepEqual(
        listed.map((x) => x.proposedText),
        ['Cut p99 latency 40% across 3 services'],
      );
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'a resume an application is tailored on is refused, and stays out of the list',
  { skip },
  async () => {
    const s = await setup();
    try {
      await assert.rejects(
        () => createResumeSuggestion(s.user.id, s.tailored.id, EDIT(s.b1.id)),
        (error: unknown) =>
          error instanceof BadRequestError && error.message.includes(`application ${s.app.id}`),
      );
      assert.deepEqual(await findApplicationUsingResume(s.user.id, s.tailored.id), {
        id: s.app.id,
        company: s.app.company,
      });
      assert.equal(await findApplicationUsingResume(s.user.id, s.own.id), null);

      const listed = (await listStandaloneResumes(s.user.id)).map((r) => r.id);
      assert.ok(listed.includes(s.own.id));
      assert.ok(!listed.includes(s.tailored.id));
      const defaultResume = await fixtures.getDefaultResumeRow(s.user.id);
      assert.equal(listed[0], defaultResume.id, 'Default comes first');
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'Chris rewords it with no review status in the way, and Apply writes his text everywhere',
  { skip },
  async () => {
    const s = await setup();
    try {
      const { suggestion } = await createResumeSuggestion(s.user.id, s.own.id, EDIT(s.b1.id));
      await updateBulletSuggestionText(s.user.id, suggestion.id, 'Cut p99 latency 40% & more');
      const applied = await resolveBulletSuggestion(s.user.id, suggestion.id, 'apply');
      assert.equal(applied.status, 'applied');
      // The library bullet, so the application's resume shows it too (C6).
      assert.equal(await s.bulletText(s.b1.id), 'Cut p99 latency 40\\% \\& more');
      assert.deepEqual(await pendingResumeSuggestions(s.user.id, s.own.id), []);
    } finally {
      await s.cleanup();
    }
  },
);

test('Save as new swaps a new bullet in on this resume only', { skip }, async () => {
  const s = await setup();
  try {
    const { suggestion } = await createResumeSuggestion(s.user.id, s.own.id, EDIT(s.b1.id));
    await resolveBulletSuggestion(s.user.id, suggestion.id, 'copy');
    const own = (await getSelections(s.own.id)).experienceBullets[s.exp.id] ?? [];
    assert.equal(own.length, 2);
    assert.notEqual(own[0], s.b1.id);
    assert.equal(await s.bulletText(own[0] ?? ''), 'Cut p99 latency 40\\%');
    assert.equal(own[1], s.b2.id);
    assert.equal(await s.bulletText(s.b1.id), BOLD);
    assert.deepEqual((await getSelections(s.tailored.id)).experienceBullets[s.exp.id], [s.b1.id]);
  } finally {
    await s.cleanup();
  }
});

test(
  'Add bullet creates it and selects it at its slot; Reject moves nothing',
  { skip },
  async () => {
    const s = await setup();
    try {
      const { suggestion: add } = await createResumeSuggestion(s.user.id, s.own.id, {
        kind: 'add',
        bulletKind: 'experience',
        parentId: s.exp.id,
        position: 1,
        proposedText: 'Mentored two engineers',
        rationale: 'Chris asked for leadership',
      });
      const { suggestion: edit } = await createResumeSuggestion(s.user.id, s.own.id, EDIT(s.b2.id));

      await resolveBulletSuggestion(s.user.id, add.id, 'apply');
      const ids = (await getSelections(s.own.id)).experienceBullets[s.exp.id] ?? [];
      assert.equal(ids.length, 3);
      assert.equal(ids[0], s.b1.id);
      assert.equal(await s.bulletText(ids[1] ?? ''), 'Mentored two engineers');
      assert.equal(ids[2], s.b2.id);

      const before = await getSelections(s.own.id);
      const rejected = await resolveBulletSuggestion(s.user.id, edit.id, 'reject');
      assert.equal(rejected.status, 'rejected');
      assert.deepEqual(await getSelections(s.own.id), before);
      assert.equal(await s.bulletText(s.b2.id), 'Shipped tooling');
      await assert.rejects(
        () => resolveBulletSuggestion(s.user.id, edit.id, 'apply'),
        (error: unknown) =>
          error instanceof BadRequestError && /already rejected/.test(error.message),
      );
    } finally {
      await s.cleanup();
    }
  },
);

test(
  "the editor's payload and its preview carry the resume's own pending suggestions only",
  { skip },
  async () => {
    const s = await setup();
    try {
      const { suggestion } = await createResumeSuggestion(
        s.user.id,
        s.own.id,
        EDIT(s.b1.id, 'Cut p99 latency 40% across 3 services'),
      );
      const done = await fixtures.insertResumeSuggestion(s.own.id, {
        bulletId: s.b2.id,
        status: 'rejected',
      });
      await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id });

      const detail = await getResumeDetail(s.user.id, s.own.id);
      assert.deepEqual(
        detail?.suggestions.map((x) => x.id),
        [suggestion.id],
      );
      assert.ok(!detail?.suggestions.some((x) => x.id === done.id));
      // The application's resume has no suggestions of its own.
      assert.deepEqual((await getResumeDetail(s.user.id, s.tailored.id))?.suggestions, []);

      const pending = await pendingResumeSuggestions(s.user.id, s.own.id);
      const { tex } = await renderResumeById(s.user.id, s.own.id, undefined, pending);
      assert.ok(tex.includes('Cut p99 latency 40\\% across 3 services'));
      assert.ok(!tex.includes('\\textbf{40\\%}'));
    } finally {
      await s.cleanup();
    }
  },
);
