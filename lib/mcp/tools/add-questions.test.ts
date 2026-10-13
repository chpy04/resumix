/**
 * `add_questions` against a real database (D-047): what it records, what a
 * re-send leaves alone, the redraft round trip through `get_application`,
 * C10, and every refusal writing nothing.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let addQuestions: typeof import('./add-questions.ts').addQuestions;
let getApplication: typeof import('./get-application.ts').getApplication;
let listQuestions: typeof import('../../queries/application-questions.ts').listQuestions;
let updateApplicationQuestion: typeof import('../../queries/application-questions.ts').updateApplicationQuestion;
let approveApplicationQuestions: typeof import('../../queries/application-questions.ts').approveApplicationQuestions;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ addQuestions } = await import('./add-questions.ts'));
  ({ getApplication } = await import('./get-application.ts'));
  ({ approveApplicationQuestions, listQuestions, updateApplicationQuestion } = await import(
    '../../queries/application-questions.ts'
  ));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const OFFICE = {
  field_ref: { page: 1, label: 'Which office?' },
  prompt: 'Which office?',
  kind: 'choice',
  options: ['NYC', 'SF', 'Boston', 'Remote'],
  required: true,
  source: 'agent',
  answer_mode: 'instruction',
  proposed_answer: 'Boston if listed, otherwise Remote',
};

const WHY = {
  field_ref: { page: 2, label: 'Why Forward Deployed Engineering?', selector: '#q-17' },
  prompt: 'Why Forward Deployed Engineering?',
  kind: 'text',
  required: true,
  source: 'agent',
  proposed_answer: "I've spent the last year building tools that sit next to their users.",
};

const NAME = {
  field_ref: { page: 0, label: 'Full name' },
  prompt: 'Full name',
  kind: 'text',
  required: true,
  source: 'profile',
  proposed_answer: 'Chris Pyle',
};

/** A fresh account with one application in `status`. */
async function setup(status: ApplicationStatus = 'proposing') {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`addq-${tag}`);
  const app = await fixtures.insertTestApplication(user.id, tag, { status });
  return { user, app, cleanup: () => fixtures.deleteApplicationRow(app.id) };
}

async function call(userId: string, applicationId: string, questions: unknown[]) {
  return addQuestions.call({ userId }, { application_id: applicationId, questions });
}

/** The tool's JSON answer, which must not be an error. */
async function recorded(userId: string, applicationId: string, questions: unknown[]) {
  const result = await call(userId, applicationId, questions);
  assert.equal(result.isError, undefined, result.content[0]?.text);
  return (
    JSON.parse(result.content[0]?.text ?? '') as {
      questions: { question_id: string; outcome: string; note?: string }[];
    }
  ).questions;
}

test(
  'add_questions records each question, and a re-send leaves it unchanged',
  { skip },
  async () => {
    const s = await setup();
    try {
      const first = await recorded(s.user.id, s.app.id, [OFFICE, WHY]);
      assert.deepEqual(
        first.map((q) => q.outcome),
        ['added', 'added'],
      );

      // The same fields again, worded and cased differently, plus a new one.
      const again = await recorded(s.user.id, s.app.id, [
        { ...WHY, field_ref: { page: 2, label: '  why forward deployed  engineering? ' } },
        { ...OFFICE, proposed_answer: 'Remote', answer_mode: 'value' },
        NAME,
      ]);
      assert.deepEqual(
        again.map((q) => [q.question_id === first[1]?.question_id, q.outcome]),
        [
          [true, 'unchanged'],
          [false, 'unchanged'],
          [false, 'added'],
        ],
      );
      assert.equal(again[1]?.question_id, first[0]?.question_id);

      const questions = await listQuestions(s.user.id, s.app.id);
      assert.deepEqual(
        questions.map((q) => [q.prompt, q.answerMode, q.answer]),
        [
          ['Which office?', 'instruction', 'Boston if listed, otherwise Remote'],
          ['Why Forward Deployed Engineering?', 'value', WHY.proposed_answer],
          ['Full name', 'value', 'Chris Pyle'],
        ],
      );
      assert.equal(questions[1]?.fieldRef.selector, '#q-17');
      assert.equal(questions[2]?.source, 'profile');
    } finally {
      await s.cleanup();
    }
  },
);

test('a re-send never touches an approved answer, or one Chris edited', { skip }, async () => {
  const s = await setup('needs_review');
  try {
    const [why, name] = await recorded(s.user.id, s.app.id, [WHY, NAME]);
    await updateApplicationQuestion(s.user.id, why!.question_id, { answer: 'My own words.' });
    await approveApplicationQuestions(s.user.id, s.app.id, [name!.question_id]);

    const again = await recorded(s.user.id, s.app.id, [
      { ...WHY, proposed_answer: 'Overwritten?' },
      { ...NAME, proposed_answer: 'Somebody Else', required: false },
    ]);
    assert.deepEqual(
      again.map((q) => q.outcome),
      ['unchanged', 'unchanged'],
    );
    const [whyAfter, nameAfter] = await listQuestions(s.user.id, s.app.id);
    assert.equal(whyAfter?.answer, 'My own words.');
    assert.equal(nameAfter?.answer, 'Chris Pyle');
    assert.equal(nameAfter?.required, true, 'what was recorded first stays');
    assert.ok(nameAfter?.approvedAt);
  } finally {
    await s.cleanup();
  }
});

test('a redraft request round-trips through get_application', { skip }, async () => {
  const s = await setup('needs_review');
  try {
    const [why] = await recorded(s.user.id, s.app.id, [WHY]);
    await updateApplicationQuestion(s.user.id, why!.question_id, {
      redraftNote: 'Mention the Acme on-call work',
    });

    const got = await getApplication.call({ userId: s.user.id }, { application_id: s.app.id });
    const body = JSON.parse(got.content[0]?.text ?? '') as {
      questions: { question_id: string; redraft_note: string | null; field_ref: unknown }[];
    };
    assert.equal(body.questions[0]?.redraft_note, 'Mention the Acme on-call work');

    const redraft = 'I ran Acme on-call for a year, so I know what users hit at 3am.';
    const [again] = await recorded(s.user.id, s.app.id, [
      { ...WHY, field_ref: body.questions[0]?.field_ref, proposed_answer: redraft },
    ]);
    assert.deepEqual(again, { question_id: why!.question_id, outcome: 'redrafted' });

    const [after] = await listQuestions(s.user.id, s.app.id);
    assert.equal(after?.answer, redraft);
    assert.equal(after?.proposedAnswer, redraft);
    assert.equal(after?.redraftNote, null, 'the request is cleared');

    // Once answered, the next re-send is an ordinary one again.
    const [last] = await recorded(s.user.id, s.app.id, [{ ...WHY, proposed_answer: 'Third.' }]);
    assert.equal(last?.outcome, 'unchanged');
  } finally {
    await s.cleanup();
  }
});

test('an EEO answer is dropped, whether flagged or caught by keyword (C10)', { skip }, async () => {
  const s = await setup();
  try {
    const result = await recorded(s.user.id, s.app.id, [
      {
        field_ref: { page: 3, label: 'Gender' },
        prompt: 'Gender',
        kind: 'choice',
        options: ['Male', 'Female', 'Decline to answer'],
        required: false,
        source: 'agent',
        proposed_answer: 'Decline to answer',
      },
      {
        field_ref: { page: 3, label: 'Demographics 2' },
        prompt: 'Please self-identify',
        kind: 'choice',
        options: ['A', 'B'],
        required: false,
        is_eeo: true,
        source: 'profile',
        proposed_answer: 'Not even a valid option',
      },
      {
        field_ref: { page: 3, label: 'Protected veteran?' },
        prompt: 'Protected veteran?',
        kind: 'bool',
        required: false,
      },
      // An answer with no source is still an answer, and still dropped.
      {
        field_ref: { page: 3, label: 'Demographics 3' },
        prompt: 'Please self-identify',
        kind: 'text',
        required: false,
        is_eeo: true,
        proposed_answer: 'Decline',
      },
    ]);
    assert.deepEqual(
      result.map((q) => [q.outcome, q.note]),
      [
        ['added', 'eeo_answer_dropped'],
        ['added', 'eeo_answer_dropped'],
        ['added', undefined],
        ['added', 'eeo_answer_dropped'],
      ],
    );
    for (const q of await listQuestions(s.user.id, s.app.id)) {
      assert.equal(q.isEeo, true, q.prompt);
      assert.equal(q.source, null, q.prompt);
      assert.equal(q.proposedAnswer, null, q.prompt);
      assert.equal(q.answer, null, q.prompt);
    }
  } finally {
    await s.cleanup();
  }
});

test('every malformed question is refused at once, and nothing is written', { skip }, async () => {
  const s = await setup();
  try {
    const result = await call(s.user.id, s.app.id, [
      NAME,
      { ...NAME, field_ref: { page: 0, label: 'FULL NAME' } },
      { ...OFFICE, options: undefined },
      { ...WHY, options: ['a'] },
      { ...WHY, field_ref: { page: 2, label: 'No source' }, source: undefined },
      { ...WHY, field_ref: { page: 2, label: 'No answer' }, proposed_answer: undefined },
      { ...WHY, field_ref: { page: 2, label: 'Blank' }, proposed_answer: '  ' },
      { ...WHY, field_ref: { page: 2, label: 'Told' }, answer_mode: 'instruction' },
      {
        ...OFFICE,
        field_ref: { page: 1, label: 'Mars' },
        answer_mode: 'value',
        proposed_answer: 'Mars',
      },
      {
        field_ref: { page: 4, label: 'Writing sample' },
        prompt: 'Writing sample',
        kind: 'file',
        required: true,
        source: 'agent',
        proposed_answer: 'take-home.pdf',
      },
    ]);
    assert.equal(result.isError, true);
    const text = result.content[0]?.text ?? '';
    assert.match(text, /^Nothing was written: /);
    for (const expected of [
      'questions.1 ("FULL NAME"): has the same field_ref as questions.0',
      'questions.2 ("Which office?"): a choice question needs options',
      'questions.3 ("Why Forward Deployed Engineering?"): only a choice or multi question takes options',
      'questions.4 ("No source"): proposed_answer needs a source',
      'questions.5 ("No answer"): source needs a proposed_answer',
      'questions.6 ("Blank"): proposed_answer is empty; leave it out to propose nothing',
      'questions.7 ("Told"): answer_mode instruction is only for a choice or multi question',
      'questions.8 ("Mars"): proposed_answer: "Mars" is not one of the options.',
      'questions.9 ("Writing sample"): a file question takes no proposed_answer; Chris picks the attachment',
    ]) {
      assert.ok(text.includes(expected), `missing: ${expected}\nin: ${text}`);
    }
    assert.deepEqual(await listQuestions(s.user.id, s.app.id), []);
  } finally {
    await s.cleanup();
  }
});

test('add_questions takes questions only while proposing or in review', { skip }, async () => {
  for (const status of ['proposing', 'needs_review'] as const) {
    const s = await setup(status);
    try {
      const [q] = await recorded(s.user.id, s.app.id, [NAME]);
      assert.equal(q?.outcome, 'added', status);
    } finally {
      await s.cleanup();
    }
  }

  const refusals: [ApplicationStatus, RegExp][] = [
    ['ready', /^This application is ready: Chris has approved it/],
    ['draft', /^This application is a draft Chris logged by hand, not one you are proposing/],
    ['applied', /^This application is applied: it has been sent/],
  ];
  for (const [status, message] of refusals) {
    const s = await setup(status);
    try {
      const result = await call(s.user.id, s.app.id, [NAME]);
      assert.equal(result.isError, true, status);
      assert.match(result.content[0]?.text ?? '', message, status);
      assert.match(result.content[0]?.text ?? '', /Nothing was written/, status);
      assert.deepEqual(await listQuestions(s.user.id, s.app.id), [], status);
    } finally {
      await s.cleanup();
    }
  }

  const s = await setup();
  const archived = await fixtures.insertTestApplication(s.user.id, fixtures.testTag(), {
    status: 'proposing',
    isArchived: true,
  });
  try {
    for (const id of [randomUUID(), archived.id]) {
      const result = await call(s.user.id, id, [NAME]);
      assert.equal(
        result.content[0]?.text,
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
  } finally {
    await fixtures.deleteApplicationRow(archived.id);
    await s.cleanup();
  }
});
