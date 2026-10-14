/**
 * The multi-user guarantee, stated as tests (T14).
 *
 * Every case here is the same shape: user A holds an id belonging to user
 * B, and tries to use it. The expected answer is always "that does not
 * exist" — never a partial success, and never a 403-flavoured error that
 * would confirm the id is real.
 *
 * These run against a real database (see test-fixtures.ts) because the
 * thing under test *is* the WHERE clause. Mocking the query layer here
 * would assert nothing.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { EMPTY_SELECTIONS } from '../types.ts';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let NotFoundError: typeof import('./errors.ts').NotFoundError;
let assembleLibrary: typeof import('./library.ts').assembleLibrary;
let authenticateApiToken: typeof import('./api-tokens.ts').authenticateApiToken;
let createApiToken: typeof import('./api-tokens.ts').createApiToken;
let revokeApiToken: typeof import('./api-tokens.ts').revokeApiToken;
let createApplication: typeof import('./applications.ts').createApplication;
let createProposedApplication: typeof import('./applications.ts').createProposedApplication;
let getApplicationRow: typeof import('./applications.ts').getApplicationRow;
let setProposedSelection: typeof import('./applications.ts').setProposedSelection;
let approveSection: typeof import('./applications.ts').approveSection;
let submitForReview: typeof import('./applications.ts').submitForReview;
let recordFinalApproval: typeof import('./applications.ts').recordFinalApproval;
let getApplicationDetail: typeof import('./applications.ts').getApplicationDetail;
let listApplications: typeof import('./applications.ts').listApplications;
let recordApplied: typeof import('./applications.ts').recordApplied;
let recordReadyApplied: typeof import('./applications.ts').recordReadyApplied;
let findReadyApplicationPinning: typeof import('./applications.ts').findReadyApplicationPinning;
let loadApplyPacket: typeof import('../apply-packet.ts').loadApplyPacket;
let serveApplyFile: typeof import('../mcp/files.ts').serveApplyFile;
let updateApplication: typeof import('./applications.ts').updateApplication;
let addApplicationFile: typeof import('./application-files.ts').addApplicationFile;
let getApplicationFileBlob: typeof import('./application-files.ts').getApplicationFileBlob;
let listApplicationFiles: typeof import('./application-files.ts').listApplicationFiles;
let updateApplicationFile: typeof import('./application-files.ts').updateApplicationFile;
let addQuestions: typeof import('./application-questions.ts').addQuestions;
let approveApplicationQuestions: typeof import('./application-questions.ts').approveApplicationQuestions;
let listQuestions: typeof import('./application-questions.ts').listQuestions;
let setQuestionRemembered: typeof import('./application-questions.ts').setQuestionRemembered;
let updateApplicationQuestion: typeof import('./application-questions.ts').updateApplicationQuestion;
let listSavedAnswers: typeof import('./saved-answers.ts').listSavedAnswers;
let createCoverLetter: typeof import('./cover-letters.ts').createCoverLetter;
let getCoverLetter: typeof import('./cover-letters.ts').getCoverLetter;
let getDefaultCoverLetter: typeof import('./cover-letters.ts').getDefaultCoverLetter;
let listCoverLetters: typeof import('./cover-letters.ts').listCoverLetters;
let updateCoverLetter: typeof import('./cover-letters.ts').updateCoverLetter;
let attachCoverLetter: typeof import('./applications.ts').attachCoverLetter;
let createResume: typeof import('./resumes.ts').createResume;
let deleteResume: typeof import('./resumes.ts').deleteResume;
let getResumeDetail: typeof import('./resumes.ts').getResumeDetail;
let getResumeRow: typeof import('./resumes.ts').getResumeRow;
let listResumeSummaries: typeof import('./resumes.ts').listResumeSummaries;
let updateResume: typeof import('./resumes.ts').updateResume;
let updateExperience: typeof import('./experiences.ts').updateExperience;
let getExperienceById: typeof import('./experiences.ts').getExperienceById;
let createExperienceBullet: typeof import('./experience-bullets.ts').createExperienceBullet;
let updateExperienceBullet: typeof import('./experience-bullets.ts').updateExperienceBullet;
let updateSkillRow: typeof import('./skill-rows.ts').updateSkillRow;
let createSkill: typeof import('./skills.ts').createSkill;
let updateSkill: typeof import('./skills.ts').updateSkill;
let getTemplateById: typeof import('./templates.ts').getTemplateById;
let updateTemplate: typeof import('./templates.ts').updateTemplate;
let getDefaultTemplate: typeof import('./templates.ts').getDefaultTemplate;
let replaceSelections: typeof import('./selections.ts').replaceSelections;
let getSelections: typeof import('./selections.ts').getSelections;
let createBulletSuggestion: typeof import('./bullet-suggestions.ts').createBulletSuggestion;
let countPendingSuggestions: typeof import('./bullet-suggestions.ts').countPendingSuggestions;
let listBulletSuggestions: typeof import('./bullet-suggestions.ts').listBulletSuggestions;
let previewSuggestions: typeof import('./bullet-suggestions.ts').previewSuggestions;
let resolveBulletSuggestion: typeof import('./bullet-suggestions.ts').resolveBulletSuggestion;
let updateBulletSuggestionText: typeof import('./bullet-suggestions.ts').updateBulletSuggestionText;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError, NotFoundError } = await import('./errors.ts'));
  ({ assembleLibrary } = await import('./library.ts'));
  ({ authenticateApiToken, createApiToken, revokeApiToken } = await import('./api-tokens.ts'));
  ({
    approveSection,
    attachCoverLetter,
    createApplication,
    createProposedApplication,
    findReadyApplicationPinning,
    getApplicationDetail,
    getApplicationRow,
    listApplications,
    recordApplied,
    recordFinalApproval,
    recordReadyApplied,
    setProposedSelection,
    submitForReview,
    updateApplication,
  } = await import('./applications.ts'));
  ({
    createCoverLetter,
    getCoverLetter,
    getDefaultCoverLetter,
    listCoverLetters,
    updateCoverLetter,
  } = await import('./cover-letters.ts'));
  ({ addApplicationFile, getApplicationFileBlob, listApplicationFiles, updateApplicationFile } =
    await import('./application-files.ts'));
  ({
    addQuestions,
    approveApplicationQuestions,
    listQuestions,
    setQuestionRemembered,
    updateApplicationQuestion,
  } = await import('./application-questions.ts'));
  ({ listSavedAnswers } = await import('./saved-answers.ts'));
  ({ loadApplyPacket } = await import('../apply-packet.ts'));
  ({ serveApplyFile } = await import('../mcp/files.ts'));
  ({
    createResume,
    deleteResume,
    getResumeDetail,
    getResumeRow,
    listResumeSummaries,
    updateResume,
  } = await import('./resumes.ts'));
  ({ getExperienceById, updateExperience } = await import('./experiences.ts'));
  ({ createExperienceBullet, updateExperienceBullet } = await import('./experience-bullets.ts'));
  ({ updateSkillRow } = await import('./skill-rows.ts'));
  ({ createSkill, updateSkill } = await import('./skills.ts'));
  ({ getDefaultTemplate, getTemplateById, updateTemplate } = await import('./templates.ts'));
  ({ getSelections, replaceSelections } = await import('./selections.ts'));
  ({
    countPendingSuggestions,
    createBulletSuggestion,
    listBulletSuggestions,
    previewSuggestions,
    resolveBulletSuggestion,
    updateBulletSuggestionText,
  } = await import('./bullet-suggestions.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

/** Two fully-provisioned accounts, each with content of their own. */
async function twoUsers() {
  const tag = fixtures.testTag();
  const alice = await fixtures.insertUser(`a-${tag}`);
  const bob = await fixtures.insertUser(`b-${tag}`);

  const aliceExp = await fixtures.insertExperience(alice.id, `a-${tag}`);
  const aliceBullet = await fixtures.insertExperienceBullet(aliceExp.id, 'Alice did a thing');
  const bobExp = await fixtures.insertExperience(bob.id, `b-${tag}`);
  const bobBullet = await fixtures.insertExperienceBullet(bobExp.id, 'Bob did a thing');

  return { tag, alice, bob, aliceExp, aliceBullet, bobExp, bobBullet };
}

test(
  'provisionUser gives every new account its own default template and Default resume',
  { skip },
  async () => {
    const user = await fixtures.insertUser(fixtures.testTag());

    const template = await getDefaultTemplate(user.id);
    assert.ok(template, 'a new user must have a default template');

    const resumes = await listResumeSummaries(user.id);
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0]?.isDefault, true);
    assert.equal(resumes[0]?.templateId, template!.id);
  },
);

test(
  'two users can each have a default resume and template (the unique index is per-user)',
  { skip },
  async () => {
    // Before T14 `ux_resume_one_default` was global, so the second account
    // provisioned would have collided.
    const a = await fixtures.insertUser(`x-${fixtures.testTag()}`);
    const b = await fixtures.insertUser(`y-${fixtures.testTag()}`);

    assert.ok(await getDefaultTemplate(a.id));
    assert.ok(await getDefaultTemplate(b.id));
    assert.notEqual((await getDefaultTemplate(a.id))!.id, (await getDefaultTemplate(b.id))!.id);
  },
);

test("a user's library contains none of another user's content", { skip }, async () => {
  const { alice, bob, aliceExp, bobExp } = await twoUsers();

  const aliceLibrary = await assembleLibrary(alice.id, true);
  assert.ok(aliceLibrary.experiences.some((e) => e.id === aliceExp.id));
  assert.ok(
    !aliceLibrary.experiences.some((e) => e.id === bobExp.id),
    "Bob's experience must not appear in Alice's library",
  );

  // ...and neither do the bullets hanging off it, which have no user_id of
  // their own and so are the easiest thing to leak.
  const allBulletContents = aliceLibrary.experiences.flatMap((e) =>
    e.bullets.map((b) => b.content),
  );
  assert.ok(!allBulletContents.includes('Bob did a thing'));

  // Templates are per-user too.
  const bobTemplate = await getDefaultTemplate(bob.id);
  assert.ok(!aliceLibrary.templates.some((t) => t.id === bobTemplate!.id));
});

test("another user's resume reads as nonexistent, not forbidden", { skip }, async () => {
  const { alice, bob } = await twoUsers();
  const bobResume = (await listResumeSummaries(bob.id))[0]!;

  assert.equal(await getResumeRow(alice.id, bobResume.id), null);
  assert.equal(await getResumeDetail(alice.id, bobResume.id), null);
  assert.ok(!(await listResumeSummaries(alice.id)).some((r) => r.id === bobResume.id));
});

test("deleting another user's resume fails and leaves it intact", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobResume = await createResume(bob.id, `Bob Target ${tag}`);
  try {
    await assert.rejects(() => deleteResume(alice.id, bobResume.id), NotFoundError);
    assert.ok(await getResumeRow(bob.id, bobResume.id), "Bob's resume must survive");
  } finally {
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test("renaming another user's resume fails", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobResume = await createResume(bob.id, `Bob Rename ${tag}`);
  try {
    await assert.rejects(
      () => updateResume(alice.id, bobResume.id, { name: 'pwned' }),
      NotFoundError,
    );
    const still = await getResumeRow(bob.id, bobResume.id);
    assert.equal(still?.name, `Bob Rename ${tag}`);
  } finally {
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test(
  "editing another user's experience, bullet, skill row, skill, or template all fail",
  { skip },
  async () => {
    const { alice, bob, bobExp, bobBullet, tag } = await twoUsers();
    const bobRow = await fixtures.insertSkillRow(bob.id, `b-${tag}`);
    const bobSkill = await fixtures.insertSkill(bobRow.id, 'Rust');
    const bobTemplate = (await getDefaultTemplate(bob.id))!;

    await assert.rejects(
      () => updateExperience(alice.id, bobExp.id, { company: 'pwned' }),
      NotFoundError,
    );
    await assert.rejects(
      () => updateExperienceBullet(alice.id, bobBullet.id, { content: 'pwned' }),
      NotFoundError,
    );
    await assert.rejects(
      () => updateSkillRow(alice.id, bobRow.id, { name: 'pwned' }),
      NotFoundError,
    );
    await assert.rejects(
      () => updateSkill(alice.id, bobSkill.id, { name: 'pwned' }),
      NotFoundError,
    );
    await assert.rejects(
      () => updateTemplate(alice.id, bobTemplate.id, { content: 'pwned' }),
      NotFoundError,
    );

    // And nothing was actually written.
    const bobLibrary = await assembleLibrary(bob.id, true);
    const exp = bobLibrary.experiences.find((e) => e.id === bobExp.id);
    assert.notEqual(exp?.company, 'pwned');
    assert.equal(exp?.bullets.find((b) => b.id === bobBullet.id)?.content, 'Bob did a thing');
    assert.equal((await getTemplateById(bob.id, bobTemplate.id))?.content, bobTemplate.content);
  },
);

test("appending a bullet to another user's experience fails", { skip }, async () => {
  const { alice, bobExp } = await twoUsers();
  assert.equal(await getExperienceById(alice.id, bobExp.id), null);
  await assert.rejects(
    () => createExperienceBullet(alice.id, bobExp.id, 'injected'),
    NotFoundError,
  );
});

test("adding a skill to another user's skill row fails", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobRow = await fixtures.insertSkillRow(bob.id, `skills-${tag}`);
  await assert.rejects(() => createSkill(alice.id, bobRow.id, 'injected'), NotFoundError);
});

test("another user's content cannot be selected onto your own resume", { skip }, async () => {
  const { alice, bobExp, bobBullet, tag } = await twoUsers();
  const aliceResume = await fixtures.insertTestResume(alice.id, tag);
  try {
    // The bridge tables carry no user_id, so this is the path that would
    // otherwise let Bob's content render on Alice's resume.
    await assert.rejects(
      () => replaceSelections(alice.id, aliceResume.id, { experiences: [bobExp.id] }),
      BadRequestError,
    );
    await assert.rejects(
      () =>
        replaceSelections(alice.id, aliceResume.id, {
          experienceBullets: { [bobExp.id]: [bobBullet.id] },
        }),
      BadRequestError,
    );

    const selections = await getSelections(aliceResume.id);
    assert.deepEqual(selections.experiences, [], 'nothing may have been written');
  } finally {
    await fixtures.deleteResumeRow(aliceResume.id);
  }
});

test("a resume cannot be pointed at another user's template", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobTemplate = (await getDefaultTemplate(bob.id))!;
  const aliceResume = await fixtures.insertTestResume(alice.id, tag);
  try {
    await assert.rejects(
      () => updateResume(alice.id, aliceResume.id, { templateId: bobTemplate.id }),
      BadRequestError,
    );
    const still = await getResumeRow(alice.id, aliceResume.id);
    assert.notEqual(still?.templateId, bobTemplate.id);
  } finally {
    await fixtures.deleteResumeRow(aliceResume.id);
  }
});

test("createResume clones your own default, never the other user's", { skip }, async () => {
  const { alice, bob, aliceExp, bobExp, tag } = await twoUsers();

  // Put each user's own experience on their own Default resume.
  const aliceDefault = await fixtures.getDefaultResumeRow(alice.id);
  const bobDefault = await fixtures.getDefaultResumeRow(bob.id);
  await replaceSelections(alice.id, aliceDefault.id, { experiences: [aliceExp.id] });
  await replaceSelections(bob.id, bobDefault.id, { experiences: [bobExp.id] });

  const clone = await createResume(bob.id, `Bob Clone ${tag}`);
  try {
    const selections = await getSelections(clone.id);
    assert.deepEqual(selections.experiences, [bobExp.id]);
  } finally {
    await fixtures.deleteResumeRow(clone.id);
  }
});

// ---------------------------------------------------------------------------
// Applications. `application` is a root table and carries `user_id`;
// `application_file` does not, and inherits its owner through a join — the
// same split, and the same risk, as an experience and its bullets.
// ---------------------------------------------------------------------------

test("another user's application reads as not found", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobApplication = await createApplication(bob.id, { company: `Bob Co ${tag}` });
  try {
    assert.equal(await getApplicationDetail(alice.id, bobApplication.id), null);
    await assert.rejects(
      () => updateApplication(alice.id, bobApplication.id, { company: 'Alice Co' }),
      NotFoundError,
    );
    await assert.rejects(() => recordApplied(alice.id, bobApplication.id, null), NotFoundError);

    const aliceBoard = await listApplications(alice.id, true);
    assert.ok(!aliceBoard.some((a) => a.id === bobApplication.id));

    // ...and nothing was written along the way.
    const untouched = await getApplicationDetail(bob.id, bobApplication.id);
    assert.equal(untouched?.company, `Bob Co ${tag}`);
    assert.equal(untouched?.status, 'draft');
  } finally {
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

test("an application cannot be pointed at another user's resume", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobResume = await fixtures.insertTestResume(bob.id, tag);
  const aliceApplication = await createApplication(alice.id, { company: `Alice Co ${tag}` });
  try {
    await assert.rejects(
      () => createApplication(alice.id, { company: 'Alice Co', resumeId: bobResume.id }),
      BadRequestError,
    );
    // ...and cloning it is the same answer: a new application may only start
    // from a resume you already own.
    await assert.rejects(
      () => createApplication(alice.id, { company: 'Alice Co', createResumeFrom: bobResume.id }),
      BadRequestError,
    );
    await assert.rejects(
      () => updateApplication(alice.id, aliceApplication.id, { resumeId: bobResume.id }),
      BadRequestError,
    );

    const still = await getApplicationDetail(alice.id, aliceApplication.id);
    assert.equal(still?.resumeId, null);
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test(
  "createProposedApplication clones your own Default, never another user's",
  { skip },
  async () => {
    const { alice, bob, aliceExp, bobExp, tag } = await twoUsers();
    const aliceDefault = await fixtures.getDefaultResumeRow(alice.id);
    const bobDefault = await fixtures.getDefaultResumeRow(bob.id);
    await replaceSelections(alice.id, aliceDefault.id, { experiences: [aliceExp.id] });
    await replaceSelections(bob.id, bobDefault.id, { experiences: [bobExp.id] });

    const created = await createProposedApplication(bob.id, {
      company: `Bob Co ${tag}`,
      roleTitle: 'Engineer',
      postingUrl: 'https://jobs.example.test/bob',
      jobDescription: 'Build.',
      agentSummary: 'Fits.',
      fitScore: 3.5,
    });
    try {
      assert.ok(created.resumeId);
      assert.ok(await getResumeRow(bob.id, created.resumeId));
      assert.equal(await getResumeRow(alice.id, created.resumeId), null);
      assert.deepEqual((await getSelections(created.resumeId)).experiences, [bobExp.id]);
      assert.equal(await getApplicationDetail(alice.id, created.id), null);
    } finally {
      await fixtures.deleteApplicationRow(created.id);
      if (created.resumeId) await fixtures.deleteResumeRow(created.resumeId);
    }
  },
);

test("setProposedSelection on another user's application writes nothing", { skip }, async () => {
  const { alice, bob, aliceExp, tag } = await twoUsers();
  const bobApplication = await fixtures.insertTestApplication(bob.id, tag, {
    status: 'proposing',
  });
  try {
    const written = await setProposedSelection(alice.id, bobApplication.id, {
      ...EMPTY_SELECTIONS,
      experiences: [aliceExp.id],
    });
    assert.equal(written, false);
    assert.equal((await getApplicationRow(bob.id, bobApplication.id))?.proposedSelection, null);
  } finally {
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

// ---------------------------------------------------------------------------
// The review flow (D-044). Each of these writes a flow status or a stamp, so
// reaching another user's row would approve their application for them.
// ---------------------------------------------------------------------------

test(
  "approving, submitting or finally approving another user's application writes nothing",
  { skip },
  async () => {
    const { alice, bob, tag } = await twoUsers();
    const bobResume = await fixtures.insertTestResume(bob.id, tag);
    const inReview = await fixtures.insertTestApplication(bob.id, `${tag}-review`, {
      status: 'needs_review',
      resumeId: bobResume.id,
      resumeApprovedAt: new Date(),
    });
    const proposing = await fixtures.insertTestApplication(bob.id, `${tag}-proposing`, {
      status: 'proposing',
      resumeId: bobResume.id,
    });
    try {
      await assert.rejects(() => approveSection(alice.id, inReview.id, 'resume'), NotFoundError);
      assert.equal(await submitForReview(alice.id, proposing.id), false);
      await assert.rejects(
        () =>
          recordFinalApproval(alice.id, inReview.id, {
            resumeId: bobResume.id,
            snapshot: { filename: 'stolen.pdf', bytes: Buffer.from('%PDF'), tex: '' },
            letter: null,
          }),
        NotFoundError,
      );

      // Nothing moved, and the snapshot Alice's call stored rolled back with it.
      assert.equal((await getApplicationRow(bob.id, proposing.id))?.status, 'proposing');
      const bobs = await getApplicationRow(bob.id, inReview.id);
      assert.equal(bobs?.status, 'needs_review');
      assert.equal(bobs?.approvedAt, null);
      assert.equal(bobs?.resumePdfId, null);
      assert.deepEqual(await fixtures.listResumePdfIds(bobResume.id), []);
    } finally {
      await fixtures.deleteApplicationRow(inReview.id);
      await fixtures.deleteApplicationRow(proposing.id);
      await fixtures.deleteResumeRow(bobResume.id);
    }
  },
);

test("your selection write never reopens another user's application", { skip }, async () => {
  const { alice, bob, aliceExp, tag } = await twoUsers();
  const aliceResume = await fixtures.insertTestResume(alice.id, tag);
  // Impossible through the API, which refuses a stranger's resume id; written
  // directly, to prove the reopen itself is scoped to the caller.
  const stamp = new Date('2026-10-12T10:00:00.000Z');
  const bobsReady = await fixtures.insertTestApplication(bob.id, tag, {
    status: 'ready',
    resumeId: aliceResume.id,
    resumeApprovedAt: stamp,
    approvedAt: stamp,
  });
  try {
    await replaceSelections(alice.id, aliceResume.id, { experiences: [aliceExp.id] });
    const row = await getApplicationRow(bob.id, bobsReady.id);
    assert.equal(row?.status, 'ready');
    assert.deepEqual(row?.resumeApprovedAt, stamp);
    assert.deepEqual(row?.approvedAt, stamp);
  } finally {
    await fixtures.deleteApplicationRow(bobsReady.id);
    await fixtures.deleteResumeRow(aliceResume.id);
  }
});

test("another user's attachments are unreachable by id", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobApplication = await createApplication(bob.id, { company: `Bob Co ${tag}` });
  try {
    const bobFile = await addApplicationFile(bob.id, bobApplication.id, {
      filename: 'offer.txt',
      contentType: 'text/plain',
      bytes: Buffer.from("Bob's offer"),
    });

    // The bytes are the point: a file carries no user_id of its own.
    assert.equal(await getApplicationFileBlob(alice.id, bobFile.id), null);
    await assert.rejects(
      () => updateApplicationFile(alice.id, bobFile.id, { isArchived: true }),
      NotFoundError,
    );
    assert.deepEqual(await listApplicationFiles(alice.id, bobApplication.id), []);
    await assert.rejects(
      () =>
        addApplicationFile(alice.id, bobApplication.id, {
          filename: 'sneaky.txt',
          contentType: 'text/plain',
          bytes: Buffer.from('nope'),
        }),
      NotFoundError,
    );

    const bobsFiles = await listApplicationFiles(bob.id, bobApplication.id);
    assert.equal(bobsFiles.length, 1);
    assert.equal(bobsFiles[0]?.isArchived, false);
  } finally {
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

// ---------------------------------------------------------------------------
// Application questions: owned through their application, like its files
// (D-047). Each way of naming one by id, from the wrong account.
// ---------------------------------------------------------------------------

test("another user's application takes no questions from you", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobApplication = await fixtures.insertTestApplication(bob.id, `b-${tag}`, {
    status: 'proposing',
  });
  try {
    await assert.rejects(
      () =>
        addQuestions(
          alice.id,
          bobApplication.id,
          [
            {
              fieldRef: { page: 0, label: 'Name' },
              prompt: 'Name',
              kind: 'text',
              options: null,
              required: true,
              isEeo: false,
              source: 'agent',
              answerMode: 'value',
              proposedAnswer: 'Alice',
            },
          ],
          ['proposing'],
        ),
      NotFoundError,
    );
    assert.deepEqual(await listQuestions(bob.id, bobApplication.id), []);
  } finally {
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

test("another user's question cannot be read, answered or approved", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const aliceApplication = await fixtures.insertTestApplication(alice.id, `a-${tag}`, {
    status: 'needs_review',
  });
  const bobApplication = await fixtures.insertTestApplication(bob.id, `b-${tag}`, {
    status: 'needs_review',
  });
  try {
    const bobQuestion = await fixtures.insertTestQuestion(bobApplication.id, { answer: "Bob's" });

    assert.deepEqual(await listQuestions(alice.id, bobApplication.id), []);
    await assert.rejects(
      () => updateApplicationQuestion(alice.id, bobQuestion.id, { answer: 'overwritten' }),
      NotFoundError,
    );

    // Through your own application, their question is an unknown id; through
    // theirs, the application itself is not found.
    await assert.rejects(
      () => approveApplicationQuestions(alice.id, aliceApplication.id, [bobQuestion.id]),
      BadRequestError,
    );
    await assert.rejects(
      () => approveApplicationQuestions(alice.id, bobApplication.id, [bobQuestion.id]),
      NotFoundError,
    );

    const untouched = await fixtures.getQuestionRow(bobQuestion.id);
    assert.equal(untouched.answer, "Bob's");
    assert.equal(untouched.approvedAt, null);
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

test("a file answer cannot name another user's attachment", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const aliceApplication = await fixtures.insertTestApplication(alice.id, `a-${tag}`, {
    status: 'needs_review',
  });
  const bobApplication = await fixtures.insertTestApplication(bob.id, `b-${tag}`);
  try {
    const bobFile = await addApplicationFile(bob.id, bobApplication.id, {
      filename: 'bob.pdf',
      contentType: 'application/pdf',
      bytes: Buffer.from('%PDF'),
    });
    const question = await fixtures.insertTestQuestion(aliceApplication.id, { kind: 'file' });
    await assert.rejects(
      () => updateApplicationQuestion(alice.id, question.id, { answer: bobFile.id }),
      BadRequestError,
    );
    assert.equal((await fixtures.getQuestionRow(question.id)).answer, null);
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

// ---------------------------------------------------------------------------
// Cover letters. A seventh root table, so the shape is the plainest one here:
// `user_id` on the row, one WHERE clause, no join to reason about (D-035).
// ---------------------------------------------------------------------------

test("another user's cover letter is unreachable by id", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobLetter = await createCoverLetter(bob.id, `Bob Letter ${tag}`);
  try {
    assert.equal(await getCoverLetter(alice.id, bobLetter.id), null);
    await assert.rejects(
      () => updateCoverLetter(alice.id, bobLetter.id, { content: 'overwritten' }),
      NotFoundError,
    );
    // Not found, never the 400 a body would get against Bob's content, which
    // has no marker: the check must not run on a row the caller cannot see
    // (D-046).
    await updateCoverLetter(bob.id, bobLetter.id, { content: '\\documentclass{article}' });
    await assert.rejects(
      () => updateCoverLetter(alice.id, bobLetter.id, { body: 'overwritten' }),
      NotFoundError,
    );
    assert.ok(!(await listCoverLetters(alice.id, true)).some((l) => l.id === bobLetter.id));

    // Copying one you cannot read is the same answer as copying one that
    // does not exist — otherwise the 400/404 split would confirm it is real.
    await assert.rejects(
      () => createCoverLetter(alice.id, 'Stolen', bobLetter.id),
      BadRequestError,
    );

    const untouched = await getCoverLetter(bob.id, bobLetter.id);
    assert.notEqual(untouched?.content, 'overwritten');
    assert.equal(untouched?.body, null);
  } finally {
    await fixtures.deleteCoverLetterRow(bobLetter.id);
  }
});

test("an application cannot be pointed at another user's cover letter", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobLetter = await createCoverLetter(bob.id, `Bob Letter ${tag}`);
  const aliceApplication = await createApplication(alice.id, { company: `Alice Co ${tag}` });
  try {
    await assert.rejects(
      () => updateApplication(alice.id, aliceApplication.id, { coverLetterId: bobLetter.id }),
      BadRequestError,
    );
    const still = await getApplicationDetail(alice.id, aliceApplication.id);
    assert.equal(still?.coverLetterId, null);

    // And the copy-and-link shortcut copies *Alice's* default, never Bob's.
    const attached = await attachCoverLetter(alice.id, aliceApplication.id);
    assert.ok(attached.coverLetterId);
    const aliceDefault = await getDefaultCoverLetter(alice.id);
    const copy = await getCoverLetter(alice.id, attached.coverLetterId!);
    assert.equal(copy?.content, aliceDefault?.content);
    assert.equal(copy?.name, attached.company);
    // A copy is never itself the default — the partial unique index would
    // reject the second one if it were.
    assert.equal(copy?.isDefault, false);

    await assert.rejects(() => attachCoverLetter(bob.id, aliceApplication.id), NotFoundError);

    await fixtures.deleteCoverLetterRow(attached.coverLetterId!);
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
    await fixtures.deleteCoverLetterRow(bobLetter.id);
  }
});

// ---------------------------------------------------------------------------
// Bullet suggestions (D-045). Owned through their application, and pointing
// at a bullet or a parent with no foreign key, so every use re-checks both.
// ---------------------------------------------------------------------------

test("another user's suggestions are unreachable, by application or by id", { skip }, async () => {
  const { alice, bob, bobExp, bobBullet, tag } = await twoUsers();
  const bobResume = await fixtures.insertTestResume(bob.id, tag);
  await replaceSelections(bob.id, bobResume.id, {
    experiences: [bobExp.id],
    experienceBullets: { [bobExp.id]: [bobBullet.id] },
  });
  const bobsApp = await fixtures.insertTestApplication(bob.id, tag, {
    status: 'needs_review',
    resumeId: bobResume.id,
  });
  const bobsProposing = await fixtures.insertTestApplication(bob.id, `${tag}-p`, {
    status: 'proposing',
    resumeId: bobResume.id,
  });
  const edit = await fixtures.insertBulletSuggestion(bobsApp.id, { bulletId: bobBullet.id });
  const add = await fixtures.insertBulletSuggestion(bobsApp.id, {
    kind: 'add',
    parentId: bobExp.id,
    position: 0,
  });
  try {
    const libraryBefore = await assembleLibrary(bob.id, true);
    const selectionsBefore = await getSelections(bobResume.id);

    assert.deepEqual(await listBulletSuggestions(alice.id, bobsApp.id), []);
    assert.equal(await countPendingSuggestions(alice.id, bobsApp.id), 0);
    await assert.rejects(
      () => previewSuggestions(alice.id, bobsApp.id, bobResume.id),
      NotFoundError,
    );
    await assert.rejects(
      () =>
        createBulletSuggestion(alice.id, bobsProposing.id, {
          kind: 'edit',
          bulletKind: 'experience',
          bulletId: bobBullet.id,
          proposedText: 'x',
          rationale: 'y',
        }),
      NotFoundError,
    );
    await assert.rejects(() => updateBulletSuggestionText(alice.id, edit.id, 'x'), NotFoundError);
    for (const [row, action] of [
      [edit, 'apply'],
      [edit, 'copy'],
      [edit, 'reject'],
      [add, 'apply'],
    ] as const) {
      await assert.rejects(() => resolveBulletSuggestion(alice.id, row.id, action), NotFoundError);
    }

    assert.deepEqual(await assembleLibrary(bob.id, true), libraryBefore);
    assert.deepEqual(await getSelections(bobResume.id), selectionsBefore);
    const bobs = await listBulletSuggestions(bob.id, bobsApp.id);
    assert.deepEqual(
      bobs.map((x) => [x.status, x.proposedText]),
      [
        ['pending', edit.proposedText],
        ['pending', add.proposedText],
      ],
    );
    assert.deepEqual(await listBulletSuggestions(bob.id, bobsProposing.id), []);
  } finally {
    await fixtures.deleteApplicationRow(bobsApp.id);
    await fixtures.deleteApplicationRow(bobsProposing.id);
    await fixtures.deleteResumeRow(bobResume.id);
  }
});

test(
  "a suggestion pointing at another user's bullet or experience fails on resolve and writes nothing",
  { skip },
  async () => {
    const { alice, bob, aliceExp, bobExp, bobBullet, tag } = await twoUsers();
    const aliceResume = await fixtures.insertTestResume(alice.id, tag);
    await replaceSelections(alice.id, aliceResume.id, { experiences: [aliceExp.id] });
    const app = await fixtures.insertTestApplication(alice.id, tag, {
      status: 'needs_review',
      resumeId: aliceResume.id,
    });
    // Impossible through the tool, which checks Alice's library; written
    // directly, to prove the resolve re-checks ownership itself.
    const edit = await fixtures.insertBulletSuggestion(app.id, { bulletId: bobBullet.id });
    const add = await fixtures.insertBulletSuggestion(app.id, {
      kind: 'add',
      parentId: bobExp.id,
      position: 0,
    });
    try {
      const bobsBefore = await assembleLibrary(bob.id, true);
      const alicesBefore = await assembleLibrary(alice.id, true);
      const selectionsBefore = await getSelections(aliceResume.id);
      for (const [row, action] of [
        [edit, 'apply'],
        [edit, 'copy'],
        [add, 'apply'],
      ] as const) {
        await assert.rejects(
          () => resolveBulletSuggestion(alice.id, row.id, action),
          NotFoundError,
        );
      }
      assert.deepEqual(await assembleLibrary(bob.id, true), bobsBefore);
      assert.deepEqual(await assembleLibrary(alice.id, true), alicesBefore);
      assert.deepEqual(await getSelections(aliceResume.id), selectionsBefore);
      const statuses = (await listBulletSuggestions(alice.id, app.id)).map((x) => x.status);
      assert.deepEqual(statuses, ['pending', 'pending']);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
      await fixtures.deleteResumeRow(aliceResume.id);
    }
  },
);

test(
  "a preview cannot borrow another user's suggestions for your own resume",
  { skip },
  async () => {
    const { alice, bob, aliceExp, tag } = await twoUsers();
    const aliceResume = await fixtures.insertTestResume(alice.id, tag);
    // Bob's application pointing at Alice's resume is impossible through the
    // API; written directly so only the owner check stands in the way.
    const bobsApp = await fixtures.insertTestApplication(bob.id, tag, {
      status: 'needs_review',
      resumeId: aliceResume.id,
    });
    await fixtures.insertBulletSuggestion(bobsApp.id, {
      kind: 'add',
      parentId: aliceExp.id,
      position: 0,
    });
    try {
      await assert.rejects(
        () => previewSuggestions(alice.id, bobsApp.id, aliceResume.id),
        NotFoundError,
      );
    } finally {
      await fixtures.deleteApplicationRow(bobsApp.id);
      await fixtures.deleteResumeRow(aliceResume.id);
    }
  },
);

// ---------------------------------------------------------------------------
// The eighth and ninth root tables, API tokens and saved answers: `user_id`
// on the row, and one WHERE clause each. Both are worth more than they look.
// A token is a credential, so reaching another user's means acting as them
// (D-039). A saved answer is approved into every application that links it,
// so linking another user's would answer your form with their words (D-048).
// ---------------------------------------------------------------------------

test(
  "another user's API token cannot be revoked, and still authenticates as them",
  { skip },
  async () => {
    const { alice, bob } = await twoUsers();
    const { token: bobToken, secret: bobSecret } = await createApiToken(bob.id, 'bob agent');

    await assert.rejects(() => revokeApiToken(alice.id, bobToken.id), NotFoundError);

    // Nothing was written: Bob's token still works, and it is still Bob's.
    const caller = await authenticateApiToken(bobSecret);
    assert.equal(caller?.id, bob.id);
    assert.notEqual(caller?.id, alice.id);
    assert.equal((await fixtures.getApiTokenRow(bobToken.id)).revokedAt, null);
  },
);

/** One text question on an application, answered. */
const WHY_INPUT = {
  fieldRef: { page: 0, label: 'Why us?' },
  prompt: 'Why us?',
  kind: 'text' as const,
  options: null,
  required: true,
  isEeo: false,
  source: null,
  answerMode: 'value' as const,
  proposedAnswer: null,
};

test("another user's saved answers are never listed or remembered into", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobSaved = await fixtures.insertSavedAnswer(bob.id, { answer: "Bob's words" });
  const bobApplication = await fixtures.insertTestApplication(bob.id, `b-${tag}`, {
    status: 'needs_review',
  });
  try {
    const aliceSaved = await fixtures.insertSavedAnswer(alice.id);
    assert.deepEqual(
      (await listSavedAnswers(alice.id)).map((a) => a.id),
      [aliceSaved.id],
    );

    const bobQuestion = await fixtures.insertTestQuestion(bobApplication.id, { answer: "Bob's" });
    for (const remember of [true, false]) {
      await assert.rejects(
        () => setQuestionRemembered(alice.id, bobQuestion.id, remember),
        NotFoundError,
        String(remember),
      );
    }
    // Nothing was written for either of them.
    assert.deepEqual(
      (await fixtures.listSavedAnswerRows(alice.id)).map((a) => a.id),
      [aliceSaved.id],
    );
    assert.deepEqual(
      (await fixtures.listSavedAnswerRows(bob.id)).map((a) => [a.id, a.isArchived]),
      [[bobSaved.id, false]],
    );
    assert.equal((await fixtures.getQuestionRow(bobQuestion.id)).savedAnswerId, null);
  } finally {
    await fixtures.deleteApplicationRow(bobApplication.id);
  }
});

test("add_questions cannot link another user's saved answer", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobSaved = await fixtures.insertSavedAnswer(bob.id);
  const aliceApplication = await fixtures.insertTestApplication(alice.id, `a-${tag}`, {
    status: 'proposing',
  });
  try {
    const refusal = async (savedAnswerId: string) => {
      let message = '';
      await assert.rejects(
        () =>
          addQuestions(
            alice.id,
            aliceApplication.id,
            [{ ...WHY_INPUT, savedAnswerId }],
            ['proposing'],
          ),
        (error: Error) => {
          message = error.message.replace(savedAnswerId, '<id>');
          return error instanceof BadRequestError;
        },
      );
      return message;
    };
    // Bob's reads exactly as one that does not exist.
    const unknown = '3f2a91c4-0b7d-4a55-9c1e-2d8e6a8f3c1e';
    assert.equal(await refusal(bobSaved.id), await refusal(unknown));
    assert.deepEqual(await listQuestions(alice.id, aliceApplication.id), []);
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
  }
});

test("a question linked to another user's saved answer cannot reach it", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const bobSaved = await fixtures.insertSavedAnswer(bob.id, { answer: "Bob's words" });
  const aliceApplication = await fixtures.insertTestApplication(alice.id, `a-${tag}`, {
    status: 'needs_review',
  });
  try {
    // A state no query writes, so it is written directly.
    const question = await fixtures.insertTestQuestion(aliceApplication.id, {
      answer: 'Alice',
      savedAnswerId: bobSaved.id,
    });
    const [listed] = await listQuestions(alice.id, aliceApplication.id);
    assert.equal(listed?.savedAnswerId, null, 'it reads as no link');

    await updateApplicationQuestion(alice.id, question.id, { answer: 'Overwritten?' });
    await setQuestionRemembered(alice.id, question.id, false);
    const untouched = await fixtures.getSavedAnswerRow(bobSaved.id);
    assert.deepEqual([untouched.answer, untouched.isArchived], ["Bob's words", false]);

    // Ticking saves one of Alice's own.
    const ticked = await setQuestionRemembered(alice.id, question.id, true);
    assert.notEqual(ticked.savedAnswerId, bobSaved.id);
    assert.deepEqual(
      (await listSavedAnswers(alice.id)).map((a) => a.answer),
      ['Overwritten?'],
    );
    assert.equal((await fixtures.getSavedAnswerRow(bobSaved.id)).answer, "Bob's words");
  } finally {
    await fixtures.deleteApplicationRow(aliceApplication.id);
  }
});

// ---------------------------------------------------------------------------
// Applying (D-050): Bob's Ready application, its packet and its files are
// as unreachable as anything else of his. A token held by Alice's agent
// must never fetch his approved documents, mark him applied, or send his
// application back to review.
// ---------------------------------------------------------------------------

test("another user's Ready application can't be applied to", { skip }, async () => {
  const { alice, bob, tag } = await twoUsers();
  const ready = await fixtures.insertReadyApplication(bob.id, `b-${tag}`);
  try {
    const bobRow = await getApplicationRow(bob.id, ready.app.id);
    // Both pins: the resume snapshot, and the letter file (D-050).
    assert.ok(bobRow?.resumePdfId && bobRow.coverLetterPdfId);

    assert.equal(await loadApplyPacket(alice.id, ready.app.id), null);
    assert.equal(await findReadyApplicationPinning(alice.id, bobRow.resumePdfId), null);
    for (const [kind, id] of [
      ['resume-pdf', bobRow.resumePdfId],
      ['application-file', bobRow.coverLetterPdfId],
    ] as const) {
      const response = await serveApplyFile(alice.id, kind, id);
      assert.equal(response.status, 404, kind);
      assert.deepEqual(await response.json(), { error: `file ${id} not found` });
    }

    assert.equal(await recordReadyApplied(alice.id, ready.app.id), null);
    await assert.rejects(
      () => addQuestions(alice.id, ready.app.id, [WHY_INPUT], ['ready', 'needs_review']),
      NotFoundError,
    );

    // Nothing was written: Bob's is still Ready, unsent, with no new question,
    // and pinned to the same two PDFs, which Bob can still fetch.
    const after = await getApplicationRow(bob.id, ready.app.id);
    assert.equal(after?.status, 'ready');
    assert.equal(after?.appliedAt, null);
    assert.ok(after?.approvedAt);
    assert.deepEqual(
      [after?.resumePdfId, after?.coverLetterPdfId],
      [bobRow.resumePdfId, bobRow.coverLetterPdfId],
    );
    const bobs = await serveApplyFile(bob.id, 'application-file', bobRow.coverLetterPdfId);
    assert.equal(bobs.status, 200);
    assert.deepEqual(await listQuestions(bob.id, ready.app.id), []);
    assert.equal((await loadApplyPacket(bob.id, ready.app.id))?.ok, true);
  } finally {
    await ready.cleanup();
  }
});
