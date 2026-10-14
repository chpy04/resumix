import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_STATUSES, MANUAL_STATUSES } from './applications/status.ts';
import {
  approveQuestionsSchema,
  approveSectionSchema,
  patchApplicationQuestionSchema,
  patchApplicationSchema,
  rememberAnswerSchema,
} from './validation.ts';

test('PATCH refuses every status the review flow owns (D-041)', () => {
  // A hand-set `ready` would skip the approvals and snapshot it vouches for.
  for (const status of FLOW_STATUSES) {
    const result = patchApplicationSchema.safeParse({ status });
    assert.equal(result.success, false, `${status} must be refused`);
    assert.match(result.error?.issues[0]?.message ?? '', /review flow/);
  }
});

test('PATCH accepts every manual status', () => {
  for (const status of MANUAL_STATUSES) {
    assert.equal(patchApplicationSchema.safeParse({ status }).success, true, status);
  }
});

test('PATCH accepts applied, which is how a ready application leaves the flow', () => {
  assert.deepEqual(patchApplicationSchema.parse({ status: 'applied' }), { status: 'applied' });
});

test('a section approval names resume or coverLetter, and nothing else', () => {
  assert.equal(approveSectionSchema.safeParse({ section: 'resume' }).success, true);
  assert.equal(approveSectionSchema.safeParse({ section: 'coverLetter' }).success, true);
  for (const section of ['approve', 'questions', undefined]) {
    assert.equal(approveSectionSchema.safeParse({ section }).success, false, String(section));
  }
});

test('a question PATCH takes an answer, a list of picks, a mode or a redraft note', () => {
  for (const body of [
    { answer: 'Because.' },
    { answer: ['NYC', 'SF'] },
    { answer: null },
    { answerMode: 'instruction' },
    { redraftNote: 'Shorter.' },
    { redraftNote: null },
  ]) {
    assert.equal(
      patchApplicationQuestionSchema.safeParse(body).success,
      true,
      JSON.stringify(body),
    );
  }
  for (const body of [{}, { answer: 4 }, { answerMode: 'guess' }]) {
    assert.equal(
      patchApplicationQuestionSchema.safeParse(body).success,
      false,
      JSON.stringify(body),
    );
  }
});

test('approving questions needs at least one question id', () => {
  const id = '3f2a91c4-0b7d-4a55-9c1e-2d8e6a8f3c1e';
  assert.equal(approveQuestionsSchema.safeParse({ questionIds: [id] }).success, true);
  for (const questionIds of [[], ['not-an-id'], undefined]) {
    assert.equal(
      approveQuestionsSchema.safeParse({ questionIds }).success,
      false,
      String(questionIds),
    );
  }
});

test('remembering an answer is a yes or a no, and nothing else', () => {
  for (const remember of [true, false]) {
    assert.equal(rememberAnswerSchema.safeParse({ remember }).success, true, String(remember));
  }
  for (const body of [{}, { remember: 'true' }, { remember: null }]) {
    assert.equal(rememberAnswerSchema.safeParse(body).success, false, JSON.stringify(body));
  }
});
