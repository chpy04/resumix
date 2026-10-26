/**
 * Bullet suggestions against a real database (D-045): what the table
 * refuses, and what each of Chris's four actions does to the library and to
 * this application's selection. Recording a suggestion writes neither.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../types.ts';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let createBulletSuggestion: typeof import('./bullet-suggestions.ts').createBulletSuggestion;
let listBulletSuggestions: typeof import('./bullet-suggestions.ts').listBulletSuggestions;
let countPendingSuggestions: typeof import('./bullet-suggestions.ts').countPendingSuggestions;
let previewSuggestions: typeof import('./bullet-suggestions.ts').previewSuggestions;
let resolveBulletSuggestion: typeof import('./bullet-suggestions.ts').resolveBulletSuggestion;
let updateBulletSuggestionText: typeof import('./bullet-suggestions.ts').updateBulletSuggestionText;
let getApplicationDetail: typeof import('./applications.ts').getApplicationDetail;
let getApplicationRow: typeof import('./applications.ts').getApplicationRow;
let assembleLibrary: typeof import('./library.ts').assembleLibrary;
let renderResumeById: typeof import('./render.ts').renderResumeById;
let getSelections: typeof import('./selections.ts').getSelections;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let snapshotResumeForApplication: typeof import('../application-pdf.ts').snapshotResumeForApplication;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError } = await import('./errors.ts'));
  ({
    countPendingSuggestions,
    createBulletSuggestion,
    listBulletSuggestions,
    previewSuggestions,
    resolveBulletSuggestion,
    updateBulletSuggestionText,
  } = await import('./bullet-suggestions.ts'));
  ({ getApplicationDetail, getApplicationRow } = await import('./applications.ts'));
  ({ assembleLibrary } = await import('./library.ts'));
  ({ renderResumeById } = await import('./render.ts'));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  ({ snapshotResumeForApplication } = await import('../application-pdf.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const BOLD = 'Cut latency \\textbf{40\\%}';

/** A fresh account: one experience with three bullets, two selected, one
 *  project with one, and an application in `status` sending a resume of its
 *  own. A second resume shows the first bullet too, to prove an edit is
 *  global. */
async function setup(status: ApplicationStatus = 'needs_review') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`sugg-${tag}`);
  const exp = await fixtures.insertExperience(user.id, tag);
  const b1 = await fixtures.insertExperienceBullet(exp.id, BOLD);
  const b2 = await fixtures.insertExperienceBullet(exp.id, 'Shipped tooling');
  const b3 = await fixtures.insertExperienceBullet(exp.id, 'Led a migration');
  const project = await fixtures.insertProject(user.id, tag);
  const p1 = await fixtures.insertProjectBullet(project.id, 'Built it');
  const resume = await fixtures.insertTestResume(user.id, tag);
  await replaceSelections(user.id, resume.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id, b2.id] },
    projects: [project.id],
    projectBullets: { [project.id]: [p1.id] },
  });
  const other = await fixtures.insertTestResume(user.id, `${tag}-other`);
  await replaceSelections(user.id, other.id, {
    experiences: [exp.id],
    experienceBullets: { [exp.id]: [b1.id] },
  });
  const app = await fixtures.insertTestApplication(user.id, tag, { status, resumeId: resume.id });

  return {
    user,
    exp,
    b1,
    b2,
    b3,
    project,
    p1,
    resume,
    other,
    app,
    /** Every bullet the account has, by parent, content and all. */
    async bullets() {
      const library = await assembleLibrary(user.id, true);
      return {
        experience: library.experiences.flatMap((e) => e.bullets),
        project: library.projects.flatMap((p) => p.bullets),
      };
    },
    async cleanup() {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(resume.id);
      await fixtures.deleteResumeRow(other.id);
    },
  };
}

/** The driver's error, under drizzle's wrapper. */
function violates(constraint: string) {
  return (error: unknown) =>
    (error as { cause?: { constraint_name?: string } }).cause?.constraint_name === constraint;
}

function refusedWith(message: string | RegExp) {
  return (error: unknown) =>
    error instanceof BadRequestError &&
    (typeof message === 'string' ? error.message === message : message.test(error.message));
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

test(
  'the table refuses a target that does not fit its kind, and empty text',
  { skip },
  async () => {
    const s = await setup();
    try {
      const bad: [Record<string, unknown>, string][] = [
        [{ kind: 'edit', bulletId: null }, 'ck_bullet_suggestion_target'],
        [{ kind: 'edit', bulletId: s.b1.id, parentId: s.exp.id }, 'ck_bullet_suggestion_target'],
        [{ kind: 'edit', bulletId: s.b1.id, position: 0 }, 'ck_bullet_suggestion_target'],
        [{ kind: 'add', parentId: s.exp.id }, 'ck_bullet_suggestion_target'],
        [{ kind: 'add', parentId: s.exp.id, position: -1 }, 'ck_bullet_suggestion_target'],
        [
          { kind: 'add', bulletId: s.b1.id, parentId: s.exp.id, position: 0 },
          'ck_bullet_suggestion_target',
        ],
        [{ bulletId: s.b1.id, proposedText: '  ' }, 'ck_bullet_suggestion_text'],
        [{ bulletId: s.b1.id, rationale: '' }, 'ck_bullet_suggestion_text'],
      ];
      for (const [values, constraint] of bad) {
        await assert.rejects(
          () => fixtures.insertBulletSuggestion(s.app.id, values),
          violates(constraint),
          JSON.stringify(values),
        );
      }
      assert.deepEqual(await listBulletSuggestions(s.user.id, s.app.id), []);
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'one pending edit per bullet; resolved ones and additions never collide',
  { skip },
  async () => {
    const s = await setup();
    try {
      await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id });
      await assert.rejects(
        () => fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id }),
        violates('ux_bullet_suggestion_pending_edit'),
      );
      await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id, status: 'rejected' });
      for (let i = 0; i < 2; i++) {
        await fixtures.insertBulletSuggestion(s.app.id, {
          kind: 'add',
          parentId: s.exp.id,
          position: 0,
        });
      }
      assert.equal((await listBulletSuggestions(s.user.id, s.app.id)).length, 4);
      assert.equal(await countPendingSuggestions(s.user.id, s.app.id), 3);
    } finally {
      await s.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// Recording one
// ---------------------------------------------------------------------------

test(
  'recording writes no bullet and no selection, and a second edit replaces the first',
  { skip },
  async () => {
    const s = await setup('proposing');
    try {
      const bulletsBefore = await s.bullets();
      const selectionsBefore = await getSelections(s.resume.id);

      const first = await createBulletSuggestion(s.user.id, s.app.id, {
        kind: 'edit',
        bulletKind: 'experience',
        bulletId: s.b1.id,
        proposedText: 'Cut p99 latency 40%',
        rationale: 'The posting stresses latency',
      });
      assert.equal(first.replaced, false);
      const second = await createBulletSuggestion(s.user.id, s.app.id, {
        kind: 'edit',
        bulletKind: 'experience',
        bulletId: s.b1.id,
        proposedText: 'Cut p99 latency 40% across 3 services',
        rationale: 'And scale',
      });
      assert.equal(second.replaced, true);
      assert.equal(second.suggestion.id, first.suggestion.id);
      const added = await createBulletSuggestion(s.user.id, s.app.id, {
        kind: 'add',
        bulletKind: 'project',
        parentId: s.project.id,
        position: 1,
        proposedText: 'Wrote the docs',
        rationale: 'The posting asks for writing',
      });
      assert.equal(added.replaced, false);

      const listed = await listBulletSuggestions(s.user.id, s.app.id);
      assert.deepEqual(
        listed.map((x) => [x.kind, x.bulletKind, x.proposedText, x.rationale, x.status]),
        [
          ['edit', 'experience', 'Cut p99 latency 40% across 3 services', 'And scale', 'pending'],
          ['add', 'project', 'Wrote the docs', 'The posting asks for writing', 'pending'],
        ],
      );
      assert.deepEqual(await s.bullets(), bulletsBefore);
      assert.deepEqual(await getSelections(s.resume.id), selectionsBefore);
      // The detail carries them too, for the review page.
      const detail = await getApplicationDetail(s.user.id, s.app.id);
      assert.deepEqual(detail?.bulletSuggestions, listed);
    } finally {
      await s.cleanup();
    }
  },
);

test('a suggestion is recorded only while proposing', { skip }, async () => {
  const s = await setup('needs_review');
  try {
    await assert.rejects(
      () =>
        createBulletSuggestion(s.user.id, s.app.id, {
          kind: 'edit',
          bulletKind: 'experience',
          bulletId: s.b1.id,
          proposedText: 'x',
          rationale: 'y',
        }),
      refusedWith(/^This application is needs_review; suggestions can only be made while/),
    );
    assert.deepEqual(await listBulletSuggestions(s.user.id, s.app.id), []);
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The preview and the snapshot
// ---------------------------------------------------------------------------

test(
  'the preview lays pending suggestions over the resume; a snapshot never does',
  { skip },
  async () => {
    const s = await setup();
    await fixtures.insertBulletSuggestion(s.app.id, {
      bulletId: s.b2.id,
      proposedText: 'Shipped tooling to 40 teams & more',
    });
    await fixtures.insertBulletSuggestion(s.app.id, {
      kind: 'add',
      parentId: s.exp.id,
      position: 0,
      proposedText: 'Ran on-call',
    });
    await fixtures.insertBulletSuggestion(s.app.id, {
      bulletId: s.b1.id,
      proposedText: 'Rejected text',
      status: 'rejected',
    });
    const latex = fixtures.stubLatex(() => 1);
    try {
      const pending = await previewSuggestions(s.user.id, s.app.id, s.resume.id);
      assert.equal(pending.length, 2);
      const { tex } = await renderResumeById(s.user.id, s.resume.id, undefined, pending);
      // Two spaces: the experience and project items, not the template's own.
      const items = tex.split('\n').filter((line) => line.startsWith('  \\resumeItem{'));
      assert.deepEqual(items, [
        '  \\resumeItem{Ran on-call}',
        `  \\resumeItem{${BOLD}}`,
        '  \\resumeItem{Shipped tooling to 40 teams \\& more}',
        '  \\resumeItem{Built it}',
      ]);

      const saved = await snapshotResumeForApplication(s.user.id, {
        resumeId: s.resume.id,
        company: s.app.company,
      });
      assert.ok(saved.ok);
      const stored = await fixtures.getLatestResumePdfTex(s.resume.id);
      assert.ok(stored?.includes('\\resumeItem{Shipped tooling}'));
      assert.ok(!stored?.includes('40 teams'));
      assert.ok(!stored?.includes('Ran on-call'));
    } finally {
      latex.restore();
      // The snapshot is not pinned, so the resume deletes with it.
      await s.cleanup();
    }
  },
);

test('the preview refuses an application that does not send this resume', { skip }, async () => {
  const s = await setup();
  try {
    await assert.rejects(
      () => previewSuggestions(s.user.id, s.app.id, s.other.id),
      (error: Error) => error.name === 'NotFoundError',
    );
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Chris's four actions
// ---------------------------------------------------------------------------

test(
  'Apply to bullet rewrites the bullet everywhere, escaped, and leaves the selection',
  { skip },
  async () => {
    const s = await setup();
    const row = await fixtures.insertBulletSuggestion(s.app.id, {
      bulletId: s.b1.id,
      proposedText: 'Cut p99 latency 40% & saved $2M',
    });
    try {
      const selectionsBefore = await getSelections(s.resume.id);
      const resolved = await resolveBulletSuggestion(s.user.id, row.id, 'apply');
      assert.equal(resolved.status, 'applied');

      const { experience } = await s.bullets();
      const escaped = 'Cut p99 latency 40\\% \\& saved \\$2M';
      assert.equal(experience.find((b) => b.id === s.b1.id)?.content, escaped);
      assert.equal(experience.length, 3, 'no bullet was created');
      assert.deepEqual(await getSelections(s.resume.id), selectionsBefore);
      // Global: the other resume that shows it now reads the new text.
      const { tex } = await renderResumeById(s.user.id, s.other.id);
      assert.ok(tex.includes(`\\resumeItem{${escaped}}`));
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'Save as new keeps the original and swaps a sibling into its place on this resume only',
  { skip },
  async () => {
    const s = await setup();
    const row = await fixtures.insertBulletSuggestion(s.app.id, {
      bulletId: s.b1.id,
      proposedText: 'Cut p99 latency 40%',
    });
    try {
      const otherBefore = await getSelections(s.other.id);
      const resolved = await resolveBulletSuggestion(s.user.id, row.id, 'copy');
      assert.equal(resolved.status, 'copied');

      const { experience } = await s.bullets();
      assert.equal(experience.find((b) => b.id === s.b1.id)?.content, BOLD);
      const sibling = experience.find((b) => b.content === 'Cut p99 latency 40\\%');
      assert.ok(sibling, 'a sibling bullet was created');
      const selections = await getSelections(s.resume.id);
      assert.deepEqual(selections.experienceBullets[s.exp.id], [sibling.id, s.b2.id]);
      assert.deepEqual(await getSelections(s.other.id), otherBefore);
    } finally {
      await s.cleanup();
    }
  },
);

test('Save as new on a bullet since unticked puts the new one last', { skip }, async () => {
  const s = await setup();
  const row = await fixtures.insertBulletSuggestion(s.app.id, {
    bulletId: s.b3.id,
    proposedText: 'Led the migration to Postgres',
  });
  try {
    await resolveBulletSuggestion(s.user.id, row.id, 'copy');
    const { experience } = await s.bullets();
    const sibling = experience.find((b) => b.content === 'Led the migration to Postgres');
    assert.ok(sibling);
    assert.deepEqual((await getSelections(s.resume.id)).experienceBullets[s.exp.id], [
      s.b1.id,
      s.b2.id,
      sibling.id,
    ]);
  } finally {
    await s.cleanup();
  }
});

test(
  'Add bullet creates it under its parent and selects it at its position',
  { skip },
  async () => {
    const s = await setup();
    const add = await fixtures.insertBulletSuggestion(s.app.id, {
      kind: 'add',
      parentId: s.exp.id,
      position: 1,
      proposedText: 'Built on-call tooling for 40 engineers',
    });
    const projectAdd = await fixtures.insertBulletSuggestion(s.app.id, {
      kind: 'add',
      bulletKind: 'project',
      parentId: s.project.id,
      position: 9,
      proposedText: 'Wrote the docs',
    });
    try {
      assert.equal((await resolveBulletSuggestion(s.user.id, add.id, 'apply')).status, 'applied');
      await resolveBulletSuggestion(s.user.id, projectAdd.id, 'apply');

      const { experience, project } = await s.bullets();
      const created = experience.find(
        (b) => b.content === 'Built on-call tooling for 40 engineers',
      );
      const docs = project.find((b) => b.content === 'Wrote the docs');
      assert.ok(created && docs);
      const selections = await getSelections(s.resume.id);
      assert.deepEqual(selections.experienceBullets[s.exp.id], [s.b1.id, created.id, s.b2.id]);
      // Past the end is last.
      assert.deepEqual(selections.projectBullets[s.project.id], [s.p1.id, docs.id]);
    } finally {
      await s.cleanup();
    }
  },
);

test('Reject changes the status and nothing else', { skip }, async () => {
  const s = await setup();
  const edit = await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id });
  const add = await fixtures.insertBulletSuggestion(s.app.id, {
    kind: 'add',
    parentId: s.exp.id,
    position: 0,
  });
  try {
    const bulletsBefore = await s.bullets();
    const selectionsBefore = await getSelections(s.resume.id);
    for (const row of [edit, add]) {
      assert.equal((await resolveBulletSuggestion(s.user.id, row.id, 'reject')).status, 'rejected');
    }
    assert.deepEqual(await s.bullets(), bulletsBefore);
    assert.deepEqual(await getSelections(s.resume.id), selectionsBefore);
    assert.equal(await countPendingSuggestions(s.user.id, s.app.id), 0);
  } finally {
    await s.cleanup();
  }
});

test('a second resolve is a 400 and writes nothing', { skip }, async () => {
  const s = await setup();
  const edit = await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id });
  const add = await fixtures.insertBulletSuggestion(s.app.id, {
    kind: 'add',
    parentId: s.exp.id,
    position: 0,
  });
  try {
    await resolveBulletSuggestion(s.user.id, edit.id, 'copy');
    await resolveBulletSuggestion(s.user.id, add.id, 'apply');
    const bulletsBefore = await s.bullets();
    const selectionsBefore = await getSelections(s.resume.id);

    const again: [string, 'apply' | 'copy' | 'reject', string][] = [
      [edit.id, 'apply', 'This suggestion was already saved as a new bullet.'],
      [edit.id, 'copy', 'This suggestion was already saved as a new bullet.'],
      [add.id, 'apply', 'This suggestion was already applied.'],
      [add.id, 'reject', 'This suggestion was already applied.'],
    ];
    for (const [id, action, message] of again) {
      await assert.rejects(
        () => resolveBulletSuggestion(s.user.id, id, action),
        refusedWith(message),
      );
    }
    assert.deepEqual(await s.bullets(), bulletsBefore);
    assert.deepEqual(await getSelections(s.resume.id), selectionsBefore);
    const statuses = (await listBulletSuggestions(s.user.id, s.app.id)).map((x) => x.status);
    assert.deepEqual(statuses, ['copied', 'applied']);
  } finally {
    await s.cleanup();
  }
});

test('outside Needs review every action is a 400 and nothing moves', { skip }, async () => {
  for (const status of ['proposing', 'ready', 'applied'] as const) {
    const s = await setup(status);
    const edit = await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b1.id });
    try {
      const bulletsBefore = await s.bullets();
      for (const action of ['apply', 'copy', 'reject'] as const) {
        await assert.rejects(
          () => resolveBulletSuggestion(s.user.id, edit.id, action),
          refusedWith(/^Suggestions are resolved in Needs review; this application is /),
          `${status} ${action}`,
        );
      }
      await assert.rejects(
        () => updateBulletSuggestionText(s.user.id, edit.id, 'new'),
        refusedWith(/^Suggestions are resolved in Needs review/),
      );
      assert.deepEqual(await s.bullets(), bulletsBefore);
      const [row] = await listBulletSuggestions(s.user.id, s.app.id);
      assert.equal(row?.status, 'pending');
      assert.equal(row?.proposedText, edit.proposedText);
      assert.equal((await getApplicationRow(s.user.id, s.app.id))?.status, status);
    } finally {
      await s.cleanup();
    }
  }
});

test('Save as new is for edits; an addition is added with Add bullet', { skip }, async () => {
  const s = await setup();
  const add = await fixtures.insertBulletSuggestion(s.app.id, {
    kind: 'add',
    parentId: s.exp.id,
    position: 0,
  });
  try {
    const before = await s.bullets();
    await assert.rejects(
      () => resolveBulletSuggestion(s.user.id, add.id, 'copy'),
      refusedWith('An addition is already a new bullet; use Add bullet.'),
    );
    assert.deepEqual(await s.bullets(), before);
    assert.equal((await listBulletSuggestions(s.user.id, s.app.id))[0]?.status, 'pending');
  } finally {
    await s.cleanup();
  }
});

test(
  'Add bullet on an approved resume reopens it, as any selection write does',
  { skip },
  async () => {
    // Unreachable through the page, which refuses resume approval while a
    // suggestion is pending; written directly to prove the hook still runs.
    const s = await setup();
    await fixtures.deleteApplicationRow(s.app.id);
    const app = await fixtures.insertTestApplication(s.user.id, fixtures.testTag(), {
      status: 'needs_review',
      resumeId: s.resume.id,
      resumeApprovedAt: new Date(),
    });
    const add = await fixtures.insertBulletSuggestion(app.id, {
      kind: 'add',
      parentId: s.exp.id,
      position: 0,
    });
    try {
      await resolveBulletSuggestion(s.user.id, add.id, 'apply');
      assert.equal((await getApplicationRow(s.user.id, app.id))?.resumeApprovedAt, null);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
      await s.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// Chris's edit to the text
// ---------------------------------------------------------------------------

test('the text can be edited while pending, and is what Apply then writes', { skip }, async () => {
  const s = await setup();
  const edit = await fixtures.insertBulletSuggestion(s.app.id, { bulletId: s.b2.id });
  try {
    const updated = await updateBulletSuggestionText(s.user.id, edit.id, 'Shipped 3 tools');
    assert.equal(updated.proposedText, 'Shipped 3 tools');
    await resolveBulletSuggestion(s.user.id, edit.id, 'apply');
    const { experience } = await s.bullets();
    assert.equal(experience.find((b) => b.id === s.b2.id)?.content, 'Shipped 3 tools');
    await assert.rejects(
      () => updateBulletSuggestionText(s.user.id, edit.id, 'Too late'),
      refusedWith('This suggestion was already applied.'),
    );
  } finally {
    await s.cleanup();
  }
});
