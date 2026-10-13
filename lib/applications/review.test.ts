import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  finalApprovalProblems,
  initialStep,
  reopenedApproval,
  reviewSteps,
  sectionApprovalProblem,
  type ReviewState,
} from './review.ts';
import { APPLICATION_STATUSES } from './status.ts';

const STAMP = '2026-10-12T10:00:00.000Z';

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    status: 'needs_review',
    resumeId: 'resume-1',
    resumeApprovedAt: null,
    coverLetterId: null,
    coverLetterApprovedAt: null,
    approvedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The final gate
// ---------------------------------------------------------------------------

test('final approval passes once every shown section is approved', () => {
  assert.deepEqual(finalApprovalProblems(state({ resumeApprovedAt: STAMP })), []);
  assert.deepEqual(
    finalApprovalProblems(
      state({ resumeApprovedAt: STAMP, coverLetterId: 'letter-1', coverLetterApprovedAt: STAMP }),
    ),
    [],
  );
});

test('final approval lists every unapproved section, in step order', () => {
  assert.deepEqual(finalApprovalProblems(state({ coverLetterId: 'letter-1' })), [
    'Approve the resume first.',
    'Approve the cover letter first.',
  ]);
});

test('a letter that is not linked is not a step, so it needs no approval (C12)', () => {
  assert.deepEqual(finalApprovalProblems(state({ resumeApprovedAt: STAMP })), []);
});

test('final approval needs a resume, and says so once', () => {
  assert.deepEqual(finalApprovalProblems(state({ resumeId: null })), [
    'This application has no resume; link one first.',
  ]);
});

test('final approval happens only from Needs review', () => {
  const approved = { resumeApprovedAt: STAMP };
  for (const status of APPLICATION_STATUSES) {
    const problems = finalApprovalProblems(state({ ...approved, status }));
    if (status === 'needs_review') assert.deepEqual(problems, [], status);
    else assert.equal(problems.length, 1, status);
  }
  assert.deepEqual(finalApprovalProblems(state({ ...approved, status: 'ready' })), [
    'Only an application in Needs review can be approved; this one is Ready.',
  ]);
});

test('Date stamps count the same as ISO strings', () => {
  assert.deepEqual(finalApprovalProblems(state({ resumeApprovedAt: new Date(STAMP) })), []);
});

// ---------------------------------------------------------------------------
// One section
// ---------------------------------------------------------------------------

test('a section can be approved in Needs review when its document is linked', () => {
  assert.equal(sectionApprovalProblem(state(), 'resume'), null);
  assert.equal(sectionApprovalProblem(state({ coverLetterId: 'letter-1' }), 'coverLetter'), null);
});

test('a section is refused outside Needs review, or with nothing to approve', () => {
  assert.equal(
    sectionApprovalProblem(state({ status: 'proposing' }), 'resume'),
    'Only an application in Needs review can be approved; this one is Proposing.',
  );
  assert.equal(
    sectionApprovalProblem(state(), 'coverLetter'),
    'This application has no cover letter to approve.',
  );
  assert.equal(
    sectionApprovalProblem(state({ resumeId: null }), 'resume'),
    'This application has no resume to approve.',
  );
});

// ---------------------------------------------------------------------------
// Reopening
// ---------------------------------------------------------------------------

test('an edit to a ready application reopens it, clearing that section and the final stamp', () => {
  const ready = state({
    status: 'ready',
    resumeApprovedAt: STAMP,
    coverLetterId: 'letter-1',
    coverLetterApprovedAt: STAMP,
    approvedAt: STAMP,
  });
  assert.deepEqual(reopenedApproval(ready, 'resume'), {
    status: 'needs_review',
    resumeApprovedAt: null,
    approvedAt: null,
  });
  assert.deepEqual(reopenedApproval(ready, 'coverLetter'), {
    status: 'needs_review',
    coverLetterApprovedAt: null,
    approvedAt: null,
  });
});

test('in Needs review an edit clears only its own section', () => {
  const both = state({
    resumeApprovedAt: STAMP,
    coverLetterId: 'letter-1',
    coverLetterApprovedAt: STAMP,
  });
  assert.deepEqual(reopenedApproval(both, 'resume'), { resumeApprovedAt: null });
  assert.deepEqual(reopenedApproval(both, 'coverLetter'), { coverLetterApprovedAt: null });
});

test('an edit to a section that was never approved changes nothing', () => {
  assert.equal(reopenedApproval(state(), 'resume'), null);
  assert.equal(reopenedApproval(state({ coverLetterApprovedAt: STAMP }), 'resume'), null);
});

test('a ready application reopens even if the edited section had no stamp of its own', () => {
  // A letter added to a ready application: there is a new section to approve.
  assert.deepEqual(
    reopenedApproval(
      state({ status: 'ready', resumeApprovedAt: STAMP, approvedAt: STAMP }),
      'coverLetter',
    ),
    { status: 'needs_review', approvedAt: null },
  );
});

test('only Needs review and Ready reopen; drafts, proposals and sent rows are left alone', () => {
  for (const status of APPLICATION_STATUSES) {
    const row = state({ status, resumeApprovedAt: STAMP, approvedAt: STAMP });
    const patch = reopenedApproval(row, 'resume');
    if (status === 'needs_review' || status === 'ready') assert.ok(patch, status);
    else assert.equal(patch, null, status);
  }
});

// ---------------------------------------------------------------------------
// The stepper
// ---------------------------------------------------------------------------

test('with a letter the steps are Resume, Cover letter, Approve', () => {
  const steps = reviewSteps(state({ coverLetterId: 'letter-1', resumeApprovedAt: STAMP }));
  assert.deepEqual(
    steps.map((s) => [s.number, s.key, s.label, s.done]),
    [
      [1, 'resume', 'Resume', true],
      [2, 'coverLetter', 'Cover letter', false],
      [3, 'approve', 'Approve', false],
    ],
  );
});

test('without a letter there is no letter step, and Approve is step 2 (C12)', () => {
  const steps = reviewSteps(state());
  assert.deepEqual(
    steps.map((s) => [s.number, s.key, s.label]),
    [
      [1, 'resume', 'Resume'],
      [2, 'approve', 'Approve'],
    ],
  );
});

test('the page opens on the first step still to do', () => {
  assert.equal(initialStep(reviewSteps(state({ coverLetterId: 'letter-1' }))), 'resume');
  assert.equal(
    initialStep(reviewSteps(state({ coverLetterId: 'letter-1', resumeApprovedAt: STAMP }))),
    'coverLetter',
  );
  assert.equal(initialStep(reviewSteps(state({ resumeApprovedAt: STAMP }))), 'approve');
});

test('a ready application opens on Approve', () => {
  const ready = state({ status: 'ready', resumeApprovedAt: STAMP, approvedAt: STAMP });
  assert.equal(initialStep(reviewSteps(ready)), 'approve');
});

test('the apply command carries the full application id', () => {
  const id = '3f2a91c4-0b7d-4a55-9c1e-2d8e6a8f3c1e';
  assert.equal(applyCommand(id), `/resumix-apply ${id}`);
});
