/**
 * `report_question` against a real database: a field the apply pass never
 * saw is recorded, and a Ready application goes back to Needs review with
 * its final approval cleared and its sections' kept (C3, R12, D-050).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { ApplicationStatus } from '../../types.ts';

const skip = !process.env.DATABASE_URL;

let reportQuestion: typeof import('./report-question.ts').reportQuestion;
let getApplicationRow: typeof import('../../queries/applications.ts').getApplicationRow;
let listQuestions: typeof import('../../queries/application-questions.ts').listQuestions;
let fixtures: typeof import('../../queries/test-fixtures.ts');

if (!skip) {
  ({ reportQuestion } = await import('./report-question.ts'));
  ({ getApplicationRow } = await import('../../queries/applications.ts'));
  ({ listQuestions } = await import('../../queries/application-questions.ts'));
  fixtures = await import('../../queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const ADULT = {
  field_ref: {
    page: 2,
    label: 'Are you 18 or older?',
    selector: 'role=radiogroup[name="Are you 18 or older?"]',
  },
  prompt: 'Are you 18 or older?',
  kind: 'bool',
  required: true,
  source: 'profile',
  proposed_answer: 'yes',
};

function call(userId: string, applicationId: string, question: unknown = ADULT) {
  return reportQuestion.call({ userId }, { application_id: applicationId, question });
}

function text(result: { content: { text: string }[] }): string {
  return result.content[0]?.text ?? '';
}

async function ready() {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`report-${tag}`);
  let knownId = '';
  const made = await fixtures.insertReadyApplication(user.id, tag, {
    async beforeApproval(applicationId) {
      knownId = (
        await fixtures.insertTestQuestion(applicationId, {
          prompt: 'Why us?',
          fieldRef: { page: 0, label: 'Why us?', selector: null },
          answer: 'Freight.',
          approvedAt: new Date(),
        })
      ).id;
    },
  });
  return { ...made, user, knownId, read: () => getApplicationRow(user.id, made.app.id) };
}

test(
  'from Ready, the field is added and the application goes back to review',
  { skip },
  async () => {
    const s = await ready();
    try {
      const before = await s.read();
      const result = await call(s.user.id, s.app.id);
      assert.equal(result.isError, undefined, text(result));
      const answer = JSON.parse(text(result)) as { question_id: string };
      assert.deepEqual(answer, {
        question_id: answer.question_id,
        outcome: 'added',
        status: 'needs_review',
      });

      const after = await s.read();
      assert.equal(after?.status, 'needs_review');
      assert.equal(after?.approvedAt, null);
      // Only the final approval: the resume and the letter are as approved.
      assert.deepEqual(after?.resumeApprovedAt, before?.resumeApprovedAt);
      assert.deepEqual(after?.coverLetterApprovedAt, before?.coverLetterApprovedAt);
      assert.ok(after?.resumeApprovedAt && after.coverLetterApprovedAt);
      assert.equal(
        after?.resumePdfId,
        before?.resumePdfId,
        'the pinned PDF stays until re-approval',
      );

      const added = (await listQuestions(s.user.id, s.app.id)).find(
        (q) => q.id === answer.question_id,
      );
      assert.deepEqual(
        [added?.kind, added?.required, added?.source, added?.answer, added?.approvedAt],
        ['bool', true, 'profile', 'yes', null],
      );
      assert.equal(added?.fieldRef.page, 2);
    } finally {
      await s.cleanup();
    }
  },
);

test(
  'in Needs review, a second field on the page is added and it stays there',
  { skip },
  async () => {
    const s = await ready();
    try {
      assert.equal((await call(s.user.id, s.app.id)).isError, undefined);
      const second = await call(s.user.id, s.app.id, {
        field_ref: { page: 2, label: 'Referral name' },
        prompt: 'Referral name',
        kind: 'text',
        required: false,
      });
      assert.equal(second.isError, undefined, text(second));
      assert.equal((JSON.parse(text(second)) as { outcome: string }).outcome, 'added');
      assert.equal((await s.read())?.status, 'needs_review');
      assert.equal((await listQuestions(s.user.id, s.app.id)).length, 3);
    } finally {
      await s.cleanup();
    }
  },
);

test('a field already in the packet is refused, and it stays Ready', { skip }, async () => {
  const s = await ready();
  try {
    const result = await call(s.user.id, s.app.id, {
      // Case and whitespace are folded, as add_questions folds them.
      field_ref: { page: 0, label: '  why  US? ' },
      prompt: 'Why us?',
      kind: 'text',
      required: false,
    });
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      `That field is already question ${s.knownId} ("Why us?") in the apply packet. Nothing ` +
        'was changed. Fill it from the packet entry with that field_ref.',
    );
    const after = await s.read();
    assert.equal(after?.status, 'ready');
    assert.ok(after?.approvedAt);
  } finally {
    await s.cleanup();
  }
});

test('a field with a pending redraft request is refused, not redrafted', { skip }, async () => {
  const s = await ready();
  // An optional text question Chris sent back for a redraft and never
  // approved: final approval does not wait for it, so it can sit on a Ready
  // application. `add_questions` would redraft it; a report must not.
  const pending = await fixtures.insertTestQuestion(s.app.id, {
    sortOrder: 1,
    prompt: 'Anything else?',
    fieldRef: { page: 1, label: 'Anything else?', selector: null },
    source: 'agent',
    proposedAnswer: 'A first draft.',
    answer: 'A first draft.',
    redraftNote: 'Shorter, please.',
  });
  try {
    const result = await call(s.user.id, s.app.id, {
      field_ref: { page: 1, label: 'Anything else?' },
      prompt: 'Anything else?',
      kind: 'text',
      required: false,
      source: 'agent',
      proposed_answer: 'A new draft.',
    });
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      `That field is already question ${pending.id} ("Anything else?") in the apply packet. ` +
        'Nothing was changed. Fill it from the packet entry with that field_ref.',
    );

    const row = await fixtures.getQuestionRow(pending.id);
    assert.deepEqual(
      [row.answer, row.redraftNote, row.approvedAt],
      ['A first draft.', 'Shorter, please.', null],
    );
    const after = await s.read();
    assert.equal(after?.status, 'ready');
    assert.ok(after?.approvedAt);
  } finally {
    await s.cleanup();
  }
});

test(
  'an EEO answer is dropped, with its note, and the question still reaches Chris',
  { skip },
  async () => {
    const s = await ready();
    try {
      const result = await call(s.user.id, s.app.id, {
        field_ref: { page: 3, label: 'Gender' },
        prompt: 'Gender',
        kind: 'choice',
        options: ['Female', 'Male', 'Decline to answer'],
        required: false,
        source: 'agent',
        proposed_answer: 'Decline to answer',
      });
      assert.equal(result.isError, undefined, text(result));
      const answer = JSON.parse(text(result)) as { question_id: string; note?: string };
      assert.equal(answer.note, 'eeo_answer_dropped');
      const gender = (await listQuestions(s.user.id, s.app.id)).find(
        (q) => q.id === answer.question_id,
      );
      assert.deepEqual([gender?.isEeo, gender?.source, gender?.answer], [true, null, null]);
      assert.equal((await s.read())?.status, 'needs_review');
    } finally {
      await s.cleanup();
    }
  },
);

test('a question that fails the checks is refused, writing nothing', { skip }, async () => {
  const s = await ready();
  try {
    const result = await call(s.user.id, s.app.id, {
      field_ref: { page: 2, label: 'Office' },
      prompt: 'Office',
      kind: 'choice',
      required: true,
    });
    assert.equal(result.isError, true);
    assert.equal(
      text(result),
      'Nothing was written: question ("Office"): a choice question needs options. Fix these ' +
        'and call again.',
    );
    assert.equal((await s.read())?.status, 'ready');
    assert.equal((await listQuestions(s.user.id, s.app.id)).length, 1);
  } finally {
    await s.cleanup();
  }
});

test('a proposing, draft or sent application takes no report', { skip }, async () => {
  const tag = fixtures.testTag();
  const user = await fixtures.insertUser(`report-st-${tag}`);
  const notApplying = (what: string) =>
    `This application is ${what}, so it is not being applied to. Nothing was recorded. Stop ` +
    'and tell Chris.';
  const expected: Partial<Record<ApplicationStatus, string>> = {
    proposing:
      'This application is still proposing; record questions with add_questions. Nothing was ' +
      'recorded.',
    draft: notApplying('a draft Chris logged by hand'),
    applied: notApplying('applied: it has been sent'),
    rejected: notApplying('rejected: it has been sent'),
  };
  for (const [status, message] of Object.entries(expected)) {
    const app = await fixtures.insertTestApplication(user.id, tag, {
      status: status as ApplicationStatus,
    });
    try {
      const result = await call(user.id, app.id);
      assert.equal(result.isError, true, status);
      assert.equal(text(result), message, status);
      assert.deepEqual(await listQuestions(user.id, app.id), [], status);
      assert.equal((await getApplicationRow(user.id, app.id))?.status, status);
    } finally {
      await fixtures.deleteApplicationRow(app.id);
    }
  }
});

test('an unknown or foreign application is not found', { skip }, async () => {
  const s = await ready();
  const other = await fixtures.insertUser(`report-other-${fixtures.testTag()}`);
  try {
    for (const [caller, id] of [
      [s.user.id, randomUUID()],
      [other.id, s.app.id],
    ] as const) {
      const result = await call(caller, id);
      assert.equal(result.isError, true);
      assert.equal(
        text(result),
        `No application ${id}. Call list_applications to find its application_id.`,
      );
    }
    assert.equal((await s.read())?.status, 'ready');
  } finally {
    await s.cleanup();
  }
});
