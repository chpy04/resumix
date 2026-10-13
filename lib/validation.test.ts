import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_STATUSES, MANUAL_STATUSES } from './applications/status.ts';
import { approveSectionSchema, patchApplicationSchema } from './validation.ts';

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
