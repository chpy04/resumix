/**
 * Application questions against a real database (D-047): the CHECKs and the
 * dedupe index, Chris's edits and what they reopen, redraft requests, file
 * answers, and approving in bulk.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../types.ts';

const skip = !process.env.DATABASE_URL;

let BadRequestError: typeof import('./errors.ts').BadRequestError;
let getApplicationRow: typeof import('./applications.ts').getApplicationRow;
let updateApplication: typeof import('./applications.ts').updateApplication;
let addApplicationFile: typeof import('./application-files.ts').addApplicationFile;
let updateApplicationFile: typeof import('./application-files.ts').updateApplicationFile;
let addQuestions: typeof import('./application-questions.ts').addQuestions;
let approveApplicationQuestions: typeof import('./application-questions.ts').approveApplicationQuestions;
let listQuestions: typeof import('./application-questions.ts').listQuestions;
let updateApplicationQuestion: typeof import('./application-questions.ts').updateApplicationQuestion;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ BadRequestError } = await import('./errors.ts'));
  ({ getApplicationRow, updateApplication } = await import('./applications.ts'));
  ({ addApplicationFile, updateApplicationFile } = await import('./application-files.ts'));
  ({ addQuestions, approveApplicationQuestions, listQuestions, updateApplicationQuestion } =
    await import('./application-questions.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const STAMP = new Date('2026-10-13T10:00:00.000Z');
const OFFICES = ['NYC', 'SF', 'Boston', 'Remote'];

/** A fresh account with one application in `status`. A ready one has its
 *  resume and final approval stamped, as final approval leaves it. */
async function setup(status: ApplicationStatus = 'needs_review') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`q-${tag}`);
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

test('every CHECK refuses the row it exists to refuse', { skip }, async () => {
  const s = await setup();
  const cases: [string, Parameters<typeof fixtures.insertTestQuestion>[1]][] = [
    ['ck_application_question_options', { kind: 'choice', options: null }],
    ['ck_application_question_options', { kind: 'text', options: ['a'] }],
    ['ck_application_question_instruction', { kind: 'text', answerMode: 'instruction' }],
    ['ck_application_question_proposal', { source: 'agent' }],
    ['ck_application_question_proposal', { proposedAnswer: 'Because.' }],
    [
      'ck_application_question_eeo',
      { isEeo: true, source: 'agent', proposedAnswer: 'Male', answer: 'Male' },
    ],
    [
      'ck_application_question_eeo',
      { isEeo: true, source: 'profile', proposedAnswer: 'Male', answer: 'Male' },
    ],
    ['ck_application_question_approved_answer', { approvedAt: STAMP }],
    [
      'ck_application_question_redraft',
      { answer: 'Because.', approvedAt: STAMP, redraftNote: 'x' },
    ],
  ];
  try {
    for (const [constraint, overrides] of cases) {
      await assert.rejects(
        () => fixtures.insertTestQuestion(s.app.id, overrides),
        violates(constraint),
        `${constraint}: ${JSON.stringify(overrides)}`,
      );
    }
    // What the EEO CHECK still allows: Chris's own answer, and a saved one.
    await fixtures.insertTestQuestion(s.app.id, { isEeo: true, answer: 'Decline to answer' });
    await fixtures.insertTestQuestion(s.app.id, {
      isEeo: true,
      source: 'saved',
      proposedAnswer: 'No',
      answer: 'No',
    });
  } finally {
    await s.cleanup();
  }
});

test('two refs differing only in case or whitespace are one field', { skip }, async () => {
  const s = await setup();
  const ref = (page: number, label: string) => ({ page, label, selector: null });
  try {
    await fixtures.insertTestQuestion(s.app.id, { fieldRef: ref(1, 'Which office?') });
    for (const label of ['WHICH OFFICE?', '  Which   office? ']) {
      await assert.rejects(
        () => fixtures.insertTestQuestion(s.app.id, { fieldRef: ref(1, label) }),
        violates('ux_application_question_field'),
        label,
      );
    }
    // Another page is another field, and so is another application.
    await fixtures.insertTestQuestion(s.app.id, { fieldRef: ref(2, 'Which office?') });
    const other = await setup();
    try {
      await fixtures.insertTestQuestion(other.app.id, { fieldRef: ref(1, 'Which office?') });
    } finally {
      await other.cleanup();
    }
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Recording questions
// ---------------------------------------------------------------------------

test(
  'addQuestions appends in order, normalizes the ref, and drops an EEO proposal',
  { skip },
  async () => {
    const s = await setup('proposing');
    try {
      await fixtures.insertTestQuestion(s.app.id, { sortOrder: 0 });
      const outcomes = await addQuestions(
        s.user.id,
        s.app.id,
        [
          {
            fieldRef: { page: 1, label: '  Which \n office? ', selector: ' #office ' },
            prompt: 'Which office?',
            kind: 'multi',
            options: OFFICES,
            required: true,
            isEeo: false,
            source: 'agent',
            answerMode: 'value',
            proposedAnswer: ['Boston', 'Remote'],
          },
          {
            fieldRef: { page: 2, label: 'Ethnicity' },
            prompt: 'Ethnicity',
            kind: 'choice',
            options: ['A', 'B', 'Decline to answer'],
            required: false,
            isEeo: false,
            source: 'profile',
            answerMode: 'value',
            proposedAnswer: 'Decline to answer',
          },
        ],
        ['proposing'],
      );
      assert.deepEqual(
        outcomes.map((o) => [o.outcome, o.note]),
        [
          ['added', undefined],
          ['added', 'eeo_answer_dropped'],
        ],
      );

      const questions = await listQuestions(s.user.id, s.app.id);
      assert.equal(questions.length, 3);
      const [, office, ethnicity] = questions;
      assert.deepEqual(office?.fieldRef, { page: 1, label: 'Which office?', selector: '#office' });
      assert.deepEqual(office?.answer, ['Boston', 'Remote']);
      assert.deepEqual(office?.proposedAnswer, ['Boston', 'Remote']);
      assert.equal((await fixtures.getQuestionRow(office!.id)).answer, '["Boston","Remote"]');
      assert.equal((await fixtures.getQuestionRow(office!.id)).sortOrder, 1);

      assert.equal(ethnicity?.isEeo, true);
      assert.equal(ethnicity?.source, null);
      assert.equal(ethnicity?.proposedAnswer, null);
      assert.equal(ethnicity?.answer, null);
    } finally {
      await s.cleanup();
    }
  },
);

test('addQuestions re-checks the status under its lock', { skip }, async () => {
  const s = await setup('ready');
  try {
    await assert.rejects(
      () =>
        addQuestions(
          s.user.id,
          s.app.id,
          [
            {
              fieldRef: { page: 0, label: 'Name' },
              prompt: 'Name',
              kind: 'text',
              options: null,
              required: true,
              isEeo: false,
              source: null,
              answerMode: 'value',
              proposedAnswer: null,
            },
          ],
          ['proposing', 'needs_review'],
        ),
      isBadRequest(/^This application changed while its questions were being recorded/),
    );
    assert.deepEqual(await listQuestions(s.user.id, s.app.id), []);
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Editing an answer
// ---------------------------------------------------------------------------

test(
  'an answer edit on a ready application unapproves it and reopens the application',
  { skip },
  async () => {
    const s = await setup('ready');
    try {
      const q = await fixtures.insertTestQuestion(s.app.id, {
        answer: 'Because.',
        approvedAt: STAMP,
        required: true,
      });
      const updated = await updateApplicationQuestion(s.user.id, q.id, { answer: 'Because!' });
      assert.equal(updated.answer, 'Because!');
      assert.equal(updated.approvedAt, null);

      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.approvedAt, null);
      assert.deepEqual(row?.resumeApprovedAt, STAMP, 'the resume stays approved');
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'a write that puts the same answer back still unapproves: there is no diffing',
  { skip },
  async () => {
    const s = await setup('needs_review');
    try {
      const q = await fixtures.insertTestQuestion(s.app.id, { answer: 'Same', approvedAt: STAMP });
      await updateApplicationQuestion(s.user.id, q.id, { answer: 'Same' });
      assert.equal((await fixtures.getQuestionRow(q.id)).approvedAt, null);
      assert.equal((await s.read())?.status, 'needs_review');
    } finally {
      await s.cleanup();
    }
  },
);

test('an edit while proposing keeps the status', { skip }, async () => {
  const s = await setup('proposing');
  try {
    const q = await fixtures.insertTestQuestion(s.app.id);
    await updateApplicationQuestion(s.user.id, q.id, { answer: 'Mine.' });
    assert.equal((await s.read())?.status, 'proposing');
  } finally {
    await s.cleanup();
  }
});

test('an answer is refused once sent, or when it does not fit the question', { skip }, async () => {
  const s = await setup('needs_review');
  try {
    const office = await fixtures.insertTestQuestion(s.app.id, {
      kind: 'choice',
      options: OFFICES,
    });
    const text = await fixtures.insertTestQuestion(s.app.id);

    await assert.rejects(
      () => updateApplicationQuestion(s.user.id, office.id, { answer: 'Mars' }),
      isBadRequest('"Mars" is not one of the options.'),
    );
    await assert.rejects(
      () => updateApplicationQuestion(s.user.id, text.id, { answerMode: 'instruction' }),
      isBadRequest('Only a choice question takes an instruction.'),
    );

    // Value, then an instruction: switching mode without an answer clears it.
    await updateApplicationQuestion(s.user.id, office.id, { answer: 'Boston' });
    const switched = await updateApplicationQuestion(s.user.id, office.id, {
      answerMode: 'instruction',
    });
    assert.equal(switched.answerMode, 'instruction');
    assert.equal(switched.answer, null);
    const instructed = await updateApplicationQuestion(s.user.id, office.id, {
      answer: 'Boston if listed, otherwise Remote',
    });
    assert.equal(instructed.answer, 'Boston if listed, otherwise Remote');

    await updateApplication(s.user.id, s.app.id, { status: 'applied' });
    await assert.rejects(
      () => updateApplicationQuestion(s.user.id, text.id, { answer: 'Late.' }),
      isBadRequest(
        'This application is Applied: it has been sent, so its answers are what went out.',
      ),
    );
  } finally {
    await s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Redraft requests
// ---------------------------------------------------------------------------

test(
  'a redraft note is set on prose, refused elsewhere, and cleared by approving',
  { skip },
  async () => {
    const s = await setup('needs_review');
    try {
      const why = await fixtures.insertTestQuestion(s.app.id, {
        source: 'agent',
        proposedAnswer: 'Draft.',
        answer: 'Draft.',
      });
      const office = await fixtures.insertTestQuestion(s.app.id, {
        kind: 'choice',
        options: OFFICES,
      });
      const gender = await fixtures.insertTestQuestion(s.app.id, { prompt: 'Gender', isEeo: true });

      const asked = await updateApplicationQuestion(s.user.id, why.id, {
        redraftNote: '  Mention the Acme on-call work ',
      });
      assert.equal(asked.redraftNote, 'Mention the Acme on-call work');

      for (const id of [office.id, gender.id]) {
        await assert.rejects(
          () => updateApplicationQuestion(s.user.id, id, { redraftNote: 'Again.' }),
          isBadRequest(
            'Only a text or letter question can be sent back for a redraft, and never an EEO one.',
          ),
        );
      }

      const [approved] = await approveApplicationQuestions(s.user.id, s.app.id, [why.id]);
      assert.equal(approved?.redraftNote, null);
      assert.ok(approved?.approvedAt);

      // An empty note cancels a request, like null.
      await updateApplicationQuestion(s.user.id, why.id, { redraftNote: 'Shorter.' });
      const cancelled = await updateApplicationQuestion(s.user.id, why.id, { redraftNote: '  ' });
      assert.equal(cancelled.redraftNote, null);
    } finally {
      await s.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// File answers
// ---------------------------------------------------------------------------

const PDF = {
  filename: 'take-home.pdf',
  contentType: 'application/pdf',
  bytes: Buffer.from('%PDF'),
};

test('a file answer must be a live attachment of the same application', { skip }, async () => {
  const s = await setup('needs_review');
  const other = await fixtures.insertTestApplication(s.user.id, `${fixtures.testTag()}-other`);
  try {
    const q = await fixtures.insertTestQuestion(s.app.id, { kind: 'file', required: true });
    const elsewhere = await addApplicationFile(s.user.id, other.id, PDF);
    const archived = await addApplicationFile(s.user.id, s.app.id, PDF);
    await updateApplicationFile(s.user.id, archived.id, { isArchived: true });

    for (const id of [elsewhere.id, archived.id, 'not-a-uuid']) {
      await assert.rejects(
        () => updateApplicationQuestion(s.user.id, q.id, { answer: id }),
        isBadRequest(`unknown attachment id: ${id}`),
        id,
      );
    }

    const live = await addApplicationFile(s.user.id, s.app.id, PDF);
    const answered = await updateApplicationQuestion(s.user.id, q.id, { answer: live.id });
    assert.equal(answered.answer, live.id);
  } finally {
    await fixtures.deleteApplicationRow(other.id);
    await s.cleanup();
  }
});

test(
  'archiving the file an approved answer names unapproves it and reopens',
  { skip },
  async () => {
    const s = await setup('ready');
    try {
      const live = await addApplicationFile(s.user.id, s.app.id, PDF);
      const q = await fixtures.insertTestQuestion(s.app.id, {
        kind: 'file',
        answer: live.id,
        approvedAt: STAMP,
      });
      const untouched = await fixtures.insertTestQuestion(s.app.id, {
        answer: 'Text.',
        approvedAt: STAMP,
      });

      await updateApplicationFile(s.user.id, live.id, { isArchived: true });
      assert.equal((await fixtures.getQuestionRow(q.id)).approvedAt, null);
      assert.deepEqual((await fixtures.getQuestionRow(untouched.id)).approvedAt, STAMP);
      const row = await s.read();
      assert.equal(row?.status, 'needs_review');
      assert.equal(row?.approvedAt, null);
    } finally {
      await s.cleanup();
    }
  },
);

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

test('bulk approval is all or nothing, and lists every problem by prompt', { skip }, async () => {
  const s = await setup('needs_review');
  try {
    const name = await fixtures.insertTestQuestion(s.app.id, { prompt: 'Name', answer: 'Chris' });
    const auth = await fixtures.insertTestQuestion(s.app.id, { prompt: 'Work authorization' });
    const office = await fixtures.insertTestQuestion(s.app.id, {
      prompt: 'Which office?',
      kind: 'choice',
      options: OFFICES,
      answer: 'Mars',
    });
    const sample = await fixtures.insertTestQuestion(s.app.id, {
      prompt: 'Writing sample',
      kind: 'file',
    });

    await assert.rejects(
      () =>
        approveApplicationQuestions(s.user.id, s.app.id, [name.id, auth.id, office.id, sample.id]),
      isBadRequest(
        'Work authorization: answer it first. Which office?: "Mars" is not one of the options. ' +
          'Writing sample: pick an attachment.',
      ),
    );
    for (const q of [name, auth, office, sample]) {
      assert.equal((await fixtures.getQuestionRow(q.id)).approvedAt, null, q.prompt);
    }
  } finally {
    await s.cleanup();
  }
});

test('bulk approval approves exactly the ids it is sent', { skip }, async () => {
  const s = await setup('needs_review');
  const other = await setup('needs_review');
  try {
    const a = await fixtures.insertTestQuestion(s.app.id, { answer: 'A' });
    const b = await fixtures.insertTestQuestion(s.app.id, { answer: 'B' });
    const later = await fixtures.insertTestQuestion(s.app.id, { answer: 'Added after load' });
    const elsewhere = await fixtures.insertTestQuestion(other.app.id, { answer: 'Elsewhere' });

    const approved = await approveApplicationQuestions(s.user.id, s.app.id, [b.id, a.id]);
    assert.deepEqual(
      approved.map((q) => q.id),
      [b.id, a.id],
    );
    assert.equal((await fixtures.getQuestionRow(later.id)).approvedAt, null);

    // Another application's question, even the same user's, is unknown here.
    await assert.rejects(
      () => approveApplicationQuestions(s.user.id, s.app.id, [later.id, elsewhere.id]),
      isBadRequest(`unknown question id: ${elsewhere.id}`),
    );
    assert.equal((await fixtures.getQuestionRow(later.id)).approvedAt, null);
  } finally {
    await other.cleanup();
    await s.cleanup();
  }
});

test('questions are approved only in Needs review', { skip }, async () => {
  for (const status of ['proposing', 'ready', 'applied'] as const) {
    const s = await setup(status);
    try {
      const q = await fixtures.insertTestQuestion(s.app.id, { answer: 'Yes.' });
      await assert.rejects(
        () => approveApplicationQuestions(s.user.id, s.app.id, [q.id]),
        isBadRequest(/^Only an application in Needs review can be approved; this one is /),
        status,
      );
      assert.equal((await fixtures.getQuestionRow(q.id)).approvedAt, null);
    } finally {
      await s.cleanup();
    }
  }
});
