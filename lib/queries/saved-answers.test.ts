/**
 * Saved answers against a real database (D-048): the CHECKs, and the
 * "remember this answer" checkbox: what ticking and unticking write, the
 * write-through while it is ticked, and that none of it is an answer edit.
 * Isolation is in `isolation.test.ts`; linking from `add_questions` is in
 * `lib/mcp/tools/add-questions.test.ts`.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../types.ts';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let getApplicationRow: typeof import('./applications.ts').getApplicationRow;
let updateApplication: typeof import('./applications.ts').updateApplication;
let listQuestions: typeof import('./application-questions.ts').listQuestions;
let setQuestionRemembered: typeof import('./application-questions.ts').setQuestionRemembered;
let updateApplicationQuestion: typeof import('./application-questions.ts').updateApplicationQuestion;
let approveApplicationQuestions: typeof import('./application-questions.ts').approveApplicationQuestions;
let listSavedAnswers: typeof import('./saved-answers.ts').listSavedAnswers;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError } = await import('./errors.ts'));
  ({ getApplicationRow, updateApplication } = await import('./applications.ts'));
  ({
    approveApplicationQuestions,
    listQuestions,
    setQuestionRemembered,
    updateApplicationQuestion,
  } = await import('./application-questions.ts'));
  ({ listSavedAnswers } = await import('./saved-answers.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const STAMP = new Date('2026-10-13T10:00:00.000Z');

/** A fresh account with one application in `status`. A ready one has its
 *  resume and final approval stamped, as final approval leaves it. */
async function setup(status: ApplicationStatus = 'needs_review') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`saved-${tag}`);
  const stamped = status === 'ready';
  const app = await fixtures.insertTestApplication(user.id, tag, {
    status,
    resumeApprovedAt: stamped ? STAMP : null,
    approvedAt: stamped ? STAMP : null,
  });
  return {
    user,
    app,
    read: () => getApplicationRow(user.id, app.id),
    cleanup: () => fixtures.deleteApplicationRow(app.id),
  };
}

/** Rejects with the named constraint, which drizzle puts on the cause. */
function violates(constraint: string) {
  return (error: unknown) =>
    (error as { cause?: { constraint_name?: string } }).cause?.constraint_name === constraint;
}

function isBadRequest(message: string | RegExp) {
  return (error: Error) =>
    error instanceof BadRequestError &&
    (typeof message === 'string' ? error.message === message : message.test(error.message));
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

test('every saved_answer CHECK refuses the row it exists to refuse', { skip }, async () => {
  const user = await fixtures.insertUser(`saved-ck-${fixtures.testTag()}`);
  const cases: [string, Parameters<typeof fixtures.insertSavedAnswer>[1]][] = [
    ['ck_saved_answer_kind', { kind: 'file', answer: '3f2a91c4-0b7d-4a55-9c1e-2d8e6a8f3c1e' }],
    ['ck_saved_answer_mode', { kind: 'text', answerMode: 'instruction' }],
    ['ck_saved_answer_mode', { kind: 'bool', answerMode: 'instruction', answer: 'yes' }],
    ['ck_saved_answer_answer', { answer: '' }],
    ['ck_saved_answer_answer', { answer: '   ' }],
  ];
  for (const [constraint, overrides] of cases) {
    await assert.rejects(
      () => fixtures.insertSavedAnswer(user.id, overrides),
      violates(constraint),
      `${constraint}: ${JSON.stringify(overrides)}`,
    );
  }
  // What the CHECKs still allow: an instruction for a choice.
  await fixtures.insertSavedAnswer(user.id, {
    kind: 'choice',
    answerMode: 'instruction',
    answer: 'Boston if listed, otherwise Remote',
  });
  assert.equal((await listSavedAnswers(user.id)).length, 1);
});

// ---------------------------------------------------------------------------
// Ticking and unticking
// ---------------------------------------------------------------------------

test('ticking saves the answer and links it, and ticking again updates it', { skip }, async () => {
  const s = await setup();
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, {
      prompt: 'Why us?',
      answer: 'Because.',
    });
    const ticked = await setQuestionRemembered(s.user.id, q.id, true);
    assert.ok(ticked.savedAnswerId);
    assert.deepEqual(await listSavedAnswers(s.user.id), [
      {
        id: ticked.savedAnswerId,
        prompt: 'Why us?',
        kind: 'text',
        answerMode: 'value',
        answer: 'Because.',
      },
    ]);
    assert.equal((await fixtures.getQuestionRow(q.id)).savedAnswerId, ticked.savedAnswerId);

    // The answer changed some other way since; ticking again saves that.
    await updateApplicationQuestion(s.user.id, q.id, { answer: 'Because!' });
    const again = await setQuestionRemembered(s.user.id, q.id, true);
    assert.equal(again.savedAnswerId, ticked.savedAnswerId, 'the same row, not a second');
    const saved = await listSavedAnswers(s.user.id);
    assert.deepEqual(
      saved.map((a) => a.answer),
      ['Because!'],
    );
  } finally {
    await s.cleanup();
  }
});

test(
  'a multi answer and a choice instruction are saved with their kind and mode',
  { skip },
  async () => {
    const s = await setup();
    try {
      const offices = ['NYC', 'SF', 'Boston', 'Remote'];
      const multi = await fixtures.insertTestQuestion(s.app.id, {
        prompt: 'Which offices?',
        kind: 'multi',
        options: offices,
        answer: '["NYC","Remote"]',
      });
      const choice = await fixtures.insertTestQuestion(s.app.id, {
        prompt: 'Which office?',
        kind: 'choice',
        options: offices,
        answerMode: 'instruction',
        answer: 'Boston if listed, otherwise Remote',
      });
      await setQuestionRemembered(s.user.id, multi.id, true);
      await setQuestionRemembered(s.user.id, choice.id, true);
      assert.deepEqual(
        (await listSavedAnswers(s.user.id)).map((a) => [a.kind, a.answerMode, a.answer]),
        [
          ['multi', 'value', ['NYC', 'Remote']],
          ['choice', 'instruction', 'Boston if listed, otherwise Remote'],
        ],
      );
    } finally {
      await s.cleanup();
    }
  },
);

test('unticking archives and unlinks, and ticking again saves a new one', { skip }, async () => {
  const s = await setup();
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, { answer: 'Because.' });
    const ticked = await setQuestionRemembered(s.user.id, q.id, true);
    const first = ticked.savedAnswerId!;

    const unticked = await setQuestionRemembered(s.user.id, q.id, false);
    assert.equal(unticked.savedAnswerId, null);
    assert.equal((await fixtures.getQuestionRow(q.id)).savedAnswerId, null);
    // Archived, never deleted (D-011), and gone from what the agent reads.
    assert.equal((await fixtures.getSavedAnswerRow(first)).isArchived, true);
    assert.deepEqual(await listSavedAnswers(s.user.id), []);

    // Unticking twice is harmless.
    await setQuestionRemembered(s.user.id, q.id, false);

    const retick = await setQuestionRemembered(s.user.id, q.id, true);
    assert.ok(retick.savedAnswerId);
    assert.notEqual(retick.savedAnswerId, first);
    assert.equal((await fixtures.getSavedAnswerRow(first)).isArchived, true);
    assert.deepEqual(
      (await listSavedAnswers(s.user.id)).map((a) => a.id),
      [retick.savedAnswerId],
    );
  } finally {
    await s.cleanup();
  }
});

test('a link to an archived saved answer reads as no link', { skip }, async () => {
  const s = await setup();
  try {
    const retired = await fixtures.insertSavedAnswer(s.user.id, { isArchived: true });
    const q = await fixtures.insertTestQuestion(s.app.id, {
      answer: 'A friend.',
      savedAnswerId: retired.id,
    });
    const [listed] = await listQuestions(s.user.id, s.app.id);
    assert.equal(listed?.savedAnswerId, null);

    // So an edit writes nothing through to it, and ticking saves anew.
    await updateApplicationQuestion(s.user.id, q.id, { answer: 'A podcast.' });
    assert.equal((await fixtures.getSavedAnswerRow(retired.id)).answer, 'A friend.');
    const ticked = await setQuestionRemembered(s.user.id, q.id, true);
    assert.notEqual(ticked.savedAnswerId, retired.id);
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Editing a remembered answer
// ---------------------------------------------------------------------------

test('an answer edit while ticked writes through, and clearing it does not', { skip }, async () => {
  const s = await setup();
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, {
      prompt: 'Why us?',
      answer: 'Because.',
    });
    const { savedAnswerId } = await setQuestionRemembered(s.user.id, q.id, true);

    const edited = await updateApplicationQuestion(s.user.id, q.id, { answer: 'Because!' });
    assert.equal(edited.savedAnswerId, savedAnswerId);
    const saved = await fixtures.getSavedAnswerRow(savedAnswerId!);
    assert.equal(saved.answer, 'Because!');
    assert.equal(saved.prompt, 'Why us?', 'the prompt stays as it was first saved');

    await updateApplicationQuestion(s.user.id, q.id, { answer: null });
    await updateApplicationQuestion(s.user.id, q.id, { answer: '   ' });
    assert.equal((await fixtures.getSavedAnswerRow(savedAnswerId!)).answer, 'Because!');

    // A redraft request alone is no answer either.
    await updateApplicationQuestion(s.user.id, q.id, { answer: 'Third.' });
    await updateApplicationQuestion(s.user.id, q.id, { redraftNote: 'Shorter' });
    assert.equal((await fixtures.getSavedAnswerRow(savedAnswerId!)).answer, 'Third.');
  } finally {
    await s.cleanup();
  }
});

test('a mode switch writes the new mode through with its answer', { skip }, async () => {
  const s = await setup();
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, {
      kind: 'choice',
      options: ['NYC', 'Remote'],
      answer: 'Remote',
    });
    const { savedAnswerId } = await setQuestionRemembered(s.user.id, q.id, true);
    // Without an answer, the switch clears it, which writes nothing through.
    await updateApplicationQuestion(s.user.id, q.id, { answerMode: 'instruction' });
    let saved = await fixtures.getSavedAnswerRow(savedAnswerId!);
    assert.deepEqual([saved.answerMode, saved.answer], ['value', 'Remote']);

    await updateApplicationQuestion(s.user.id, q.id, { answer: 'Remote unless NYC is listed' });
    saved = await fixtures.getSavedAnswerRow(savedAnswerId!);
    assert.deepEqual(
      [saved.answerMode, saved.answer],
      ['instruction', 'Remote unless NYC is listed'],
    );
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Remembering is not an answer edit (C3)
// ---------------------------------------------------------------------------

test(
  'ticking and unticking leave the approval alone, and a ready one ready',
  { skip },
  async () => {
    const s = await setup('ready');
    try {
      const q = await fixtures.insertTestQuestion(s.app.id, {
        answer: 'Because.',
        required: true,
        approvedAt: STAMP,
      });
      const ticked = await setQuestionRemembered(s.user.id, q.id, true);
      assert.equal(ticked.approvedAt, STAMP.toISOString());
      await setQuestionRemembered(s.user.id, q.id, false);

      const row = await fixtures.getQuestionRow(q.id);
      assert.deepEqual(row.approvedAt, STAMP);
      assert.equal(row.answer, 'Because.');
      assert.equal(row.source, null);
      const app = await s.read();
      assert.equal(app?.status, 'ready');
      assert.deepEqual(app?.approvedAt, STAMP);
    } finally {
      await s.cleanup();
    }
  },
);

test('approving a remembered question answers with its live link', { skip }, async () => {
  const s = await setup();
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, { answer: 'Because.' });
    const { savedAnswerId } = await setQuestionRemembered(s.user.id, q.id, true);
    const [approved] = await approveApplicationQuestions(s.user.id, s.app.id, [q.id]);
    assert.equal(approved?.savedAnswerId, savedAnswerId);
  } finally {
    await s.cleanup();
  }
});

test(
  'remembering is refused on a file question, an unanswered one, and once sent',
  { skip },
  async () => {
    const s = await setup('needs_review');
    try {
      const file = await fixtures.insertTestQuestion(s.app.id, { kind: 'file' });
      await assert.rejects(
        () => setQuestionRemembered(s.user.id, file.id, true),
        isBadRequest("File answers can't be remembered."),
      );
      const blank = await fixtures.insertTestQuestion(s.app.id);
      await assert.rejects(
        () => setQuestionRemembered(s.user.id, blank.id, true),
        isBadRequest('Answer it first.'),
      );
      assert.deepEqual(await listSavedAnswers(s.user.id), []);

      const answered = await fixtures.insertTestQuestion(s.app.id, { answer: 'Because.' });
      const { savedAnswerId } = await setQuestionRemembered(s.user.id, answered.id, true);
      await updateApplication(s.user.id, s.app.id, { status: 'applied' });
      for (const remember of [true, false]) {
        await assert.rejects(
          () => setQuestionRemembered(s.user.id, answered.id, remember),
          isBadRequest(/^This application is Applied: it has been sent/),
          String(remember),
        );
      }
      assert.equal((await fixtures.getSavedAnswerRow(savedAnswerId!)).isArchived, false);
    } finally {
      await s.cleanup();
    }
  },
);
