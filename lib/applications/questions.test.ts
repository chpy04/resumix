import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerProblem,
  answerText,
  approvalProblem,
  canRedraft,
  decodeAnswer,
  decodeProposal,
  encodeAnswer,
  fieldKey,
  looksLikeEeo,
  normalizeFieldRef,
  questionProgress,
  rememberProblem,
  reopenedQuestions,
  reviewGroups,
  sameAnswer,
  savedAnswerProblem,
  wordCount,
} from './questions.ts';

const OFFICES = ['NYC', 'SF', 'Boston', 'Remote'];
const choice = { kind: 'choice' as const, options: OFFICES };
const multi = { kind: 'multi' as const, options: OFFICES };
const STAMP = '2026-10-13T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Field refs
// ---------------------------------------------------------------------------

test('a field ref is stored with its label trimmed and its whitespace collapsed', () => {
  assert.deepEqual(normalizeFieldRef({ page: 1, label: '  Which \n office?  ' }), {
    page: 1,
    label: 'Which office?',
    selector: null,
  });
  assert.deepEqual(normalizeFieldRef({ page: 0, label: 'Name', selector: ' #name ' }), {
    page: 0,
    label: 'Name',
    selector: '#name',
  });
  assert.equal(normalizeFieldRef({ page: 0, label: 'Name', selector: '  ' }).selector, null);
});

test('fieldKey folds case and whitespace, keeps the page, and ignores the selector', () => {
  assert.equal(fieldKey({ page: 1, label: 'Which office?' }), '1|which office?');
  assert.equal(
    fieldKey({ page: 1, label: '  WHICH   office? ' }),
    fieldKey({ page: 1, label: 'which office?' }),
  );
  assert.notEqual(
    fieldKey({ page: 1, label: 'Which office?' }),
    fieldKey({ page: 2, label: 'Which office?' }),
  );
  const a = normalizeFieldRef({ page: 0, label: 'Email', selector: '#input-17' });
  const b = normalizeFieldRef({ page: 0, label: 'Email', selector: '#input-42' });
  assert.equal(fieldKey(a), fieldKey(b));
});

// ---------------------------------------------------------------------------
// EEO (C10)
// ---------------------------------------------------------------------------

test('looksLikeEeo catches the demographic questions forms ask', () => {
  for (const prompt of [
    'Gender',
    'What is your gender identity?',
    'Sex',
    'Sexual orientation',
    'Race',
    'Racial background',
    'Ethnicity',
    'Are you Hispanic or Latino?',
    'Latinx heritage',
    'Veteran status',
    'Protected veteran',
    'Disability status',
    'Do you have a disability?',
    'Are you disabled?',
    'Do you have a disability accommodation request?',
    'Do you identify as transgender?',
    'Do you identify as non-binary?',
    'Two or more races',
    'What are your pronouns?',
    'Are you a member of the LGBTQ+ community?',
    'Voluntary self-identification',
  ]) {
    assert.equal(looksLikeEeo(prompt), true, prompt);
  }
});

test('looksLikeEeo leaves ordinary questions alone', () => {
  for (const prompt of [
    'Which office?',
    'Why Forward Deployed Engineering?',
    'Are you based in Essex?',
    'How do you embrace ambiguity?',
    'Work authorization',
    'Latin America experience',
    'Tell us about a time you raced a deadline.',
    'Do you have veterinary experience?',
    'Do you require visa sponsorship?',
    'What are your salary expectations?',
    'Are you willing to relocate?',
    'Describe a project you are proud of.',
    'How did you hear about us?',
  ]) {
    assert.equal(looksLikeEeo(prompt), false, prompt);
  }
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

test('every kind stores its value as text, and multi stores a JSON array', () => {
  assert.equal(encodeAnswer('Because.'), 'Because.');
  assert.equal(encodeAnswer('Boston'), 'Boston');
  assert.equal(encodeAnswer(['NYC', 'SF']), '["NYC","SF"]');
  assert.deepEqual(decodeAnswer('multi', 'value', '["NYC","SF"]'), ['NYC', 'SF']);
  // An instruction is words, even on a multi question.
  assert.equal(decodeAnswer('multi', 'instruction', '["NYC"]'), '["NYC"]');
  assert.equal(decodeAnswer('text', 'value', '["NYC"]'), '["NYC"]');
});

test('a multi proposal reads as picks when it is a list, and as words when it is not', () => {
  // The answer's mode may have been switched since the proposal was made.
  assert.deepEqual(decodeProposal('multi', '["NYC"]'), ['NYC']);
  assert.equal(decodeProposal('multi', 'Any east-coast office'), 'Any east-coast office');
  assert.equal(decodeProposal('choice', 'Boston'), 'Boston');
  assert.equal(decodeProposal('text', null), null);
});

test('whitespace and an empty pick are no answer at all', () => {
  assert.equal(encodeAnswer(null), null);
  assert.equal(encodeAnswer('  \n'), null);
  assert.equal(encodeAnswer([]), null);
  assert.equal(decodeAnswer('text', 'value', null), null);
});

test('sameAnswer compares what would be stored, mode included', () => {
  assert.ok(sameAnswer({ answerMode: 'value', answer: '' }, { answerMode: 'value', answer: null }));
  assert.ok(
    sameAnswer({ answerMode: 'value', answer: ['SF'] }, { answerMode: 'value', answer: ['SF'] }),
  );
  assert.ok(
    !sameAnswer({ answerMode: 'value', answer: 'x' }, { answerMode: 'instruction', answer: 'x' }),
  );
  assert.ok(
    !sameAnswer({ answerMode: 'value', answer: 'a' }, { answerMode: 'value', answer: 'b' }),
  );
});

// ---------------------------------------------------------------------------
// answerProblem
// ---------------------------------------------------------------------------

test('a choice takes exactly one of its options, or an instruction', () => {
  assert.equal(answerProblem(choice, 'Boston', 'value'), null);
  assert.equal(answerProblem(choice, 'boston', 'value'), '"boston" is not one of the options.');
  assert.equal(answerProblem(choice, ['Boston'], 'value'), 'This takes one answer, not a list.');
  assert.equal(answerProblem(choice, 'Boston if listed, otherwise Remote', 'instruction'), null);
  assert.equal(
    answerProblem(choice, ['Boston'], 'instruction'),
    'An instruction is text, not a list.',
  );
});

test('a multi takes a list of distinct options, or an instruction', () => {
  assert.equal(answerProblem(multi, ['NYC', 'Remote'], 'value'), null);
  assert.equal(answerProblem(multi, ['NYC', 'Mars'], 'value'), '"Mars" is not one of the options.');
  assert.equal(answerProblem(multi, ['NYC', 'NYC'], 'value'), '"NYC" is picked twice.');
  assert.equal(answerProblem(multi, 'NYC', 'value'), 'Pick from the options, as a list.');
  assert.equal(answerProblem(multi, 'Any east-coast office', 'instruction'), null);
});

test('only choice and multi take an instruction', () => {
  for (const kind of ['text', 'bool', 'file', 'letter'] as const) {
    assert.equal(
      answerProblem({ kind, options: null }, 'whatever', 'instruction'),
      'Only a choice question takes an instruction.',
      kind,
    );
  }
});

test('bool is yes or no, and prose takes any text', () => {
  const bool = { kind: 'bool' as const, options: null };
  assert.equal(answerProblem(bool, 'yes', 'value'), null);
  assert.equal(answerProblem(bool, 'no', 'value'), null);
  assert.equal(answerProblem(bool, 'Yes', 'value'), 'Answer yes or no.');
  assert.equal(answerProblem({ kind: 'text', options: null }, 'Anything at all.', 'value'), null);
  assert.equal(answerProblem({ kind: 'letter', options: null }, 'Dear team,', 'value'), null);
});

test('clearing an answer is always savable', () => {
  assert.equal(answerProblem(choice, null, 'value'), null);
  assert.equal(answerProblem(multi, [], 'value'), null);
  assert.equal(answerProblem(choice, '', 'instruction'), null);
});

// ---------------------------------------------------------------------------
// approvalProblem
// ---------------------------------------------------------------------------

const FILES = [
  { id: 'file-live', isArchived: false },
  { id: 'file-archived', isArchived: true },
];

test('approval needs an answer', () => {
  const text = { kind: 'text' as const, options: null, answerMode: 'value' as const };
  assert.equal(approvalProblem({ ...text, answer: null }, FILES), 'Answer it first.');
  assert.equal(approvalProblem({ ...text, answer: '   ' }, FILES), 'Answer it first.');
  assert.equal(approvalProblem({ ...text, answer: 'Done.' }, FILES), null);
  assert.equal(
    approvalProblem({ ...choice, answerMode: 'instruction', answer: '' }, FILES),
    'Answer it first.',
  );
});

test('approval needs a valid answer', () => {
  assert.equal(
    approvalProblem({ ...choice, answerMode: 'value', answer: 'Mars' }, FILES),
    '"Mars" is not one of the options.',
  );
  assert.equal(approvalProblem({ ...multi, answerMode: 'value', answer: ['SF'] }, FILES), null);
});

test("a file answer must be one of the application's live attachments", () => {
  const file = { kind: 'file' as const, options: null, answerMode: 'value' as const };
  assert.equal(approvalProblem({ ...file, answer: null }, FILES), 'Pick an attachment.');
  assert.equal(approvalProblem({ ...file, answer: 'file-live' }, FILES), null);
  assert.equal(approvalProblem({ ...file, answer: 'file-archived' }, FILES), 'Pick an attachment.');
  assert.equal(approvalProblem({ ...file, answer: 'someone-else' }, FILES), 'Pick an attachment.');
});

// ---------------------------------------------------------------------------
// Saved answers (D-048)
// ---------------------------------------------------------------------------

const text = { kind: 'text' as const, options: null };
const letter = { kind: 'letter' as const, options: null };

test('a saved answer fits only its own kind, text and letter counting as one', () => {
  const prose = { kind: 'text' as const, answerMode: 'value' as const, answer: 'Because.' };
  assert.equal(savedAnswerProblem(text, prose), null);
  assert.equal(savedAnswerProblem(letter, prose), null);
  assert.equal(savedAnswerProblem(text, { ...prose, kind: 'letter' }), null);
  assert.equal(
    savedAnswerProblem({ kind: 'bool', options: null }, { ...prose, answer: 'yes' }),
    'It is a text answer, and this is a bool question.',
  );
  assert.equal(
    savedAnswerProblem(text, { kind: 'bool', answerMode: 'value', answer: 'no' }),
    'It is a bool answer, and this is a text question.',
  );
  assert.equal(
    savedAnswerProblem(multi, { kind: 'choice', answerMode: 'value', answer: 'NYC' }),
    'It is a choice answer, and this is a multi question.',
  );
});

test("a saved choice must be one of this question's options exactly", () => {
  const boston = { kind: 'choice' as const, answerMode: 'value' as const, answer: 'Boston' };
  assert.equal(savedAnswerProblem(choice, boston), null);
  assert.equal(
    savedAnswerProblem({ kind: 'choice', options: ['NYC', 'SF'] }, boston),
    '"Boston" is not one of the options.',
  );
  assert.equal(
    savedAnswerProblem({ kind: 'choice', options: ['boston'] }, boston),
    '"Boston" is not one of the options.',
  );
  assert.equal(
    savedAnswerProblem(multi, { kind: 'multi', answerMode: 'value', answer: ['SF', 'Mars'] }),
    '"Mars" is not one of the options.',
  );
  assert.equal(
    savedAnswerProblem(multi, { kind: 'multi', answerMode: 'value', answer: ['SF', 'NYC'] }),
    null,
  );
});

test('a saved instruction fits any question of its kind, whatever the options', () => {
  const words = 'Boston if listed, otherwise Remote';
  assert.equal(
    savedAnswerProblem(
      { kind: 'choice', options: ['Austin', 'Denver'] },
      { kind: 'choice', answerMode: 'instruction', answer: words },
    ),
    null,
  );
  assert.equal(
    savedAnswerProblem(multi, { kind: 'multi', answerMode: 'instruction', answer: words }),
    null,
  );
});

test('a file question takes no saved answer', () => {
  assert.equal(
    savedAnswerProblem(
      { kind: 'file', options: null },
      { kind: 'text', answerMode: 'value', answer: 'x' },
    ),
    'A file question takes no saved answer.',
  );
});

test('answerText puts any answer on one line', () => {
  assert.equal(answerText({ kind: 'text', answerMode: 'value', answer: 'Because.' }), 'Because.');
  assert.equal(answerText({ kind: 'bool', answerMode: 'value', answer: 'no' }), 'No');
  assert.equal(answerText({ kind: 'choice', answerMode: 'value', answer: 'Boston' }), 'Boston');
  assert.equal(
    answerText({ kind: 'multi', answerMode: 'value', answer: ['NYC', 'Remote'] }),
    'NYC, Remote',
  );
  assert.equal(
    answerText({ kind: 'choice', answerMode: 'instruction', answer: 'Boston if listed' }),
    '“Boston if listed”',
  );
  assert.equal(answerText({ kind: 'text', answerMode: 'value', answer: null }), '');
});

test('only an answered, valid, non-file answer can be remembered', () => {
  assert.equal(rememberProblem({ ...text, answerMode: 'value', answer: 'Because.' }), null);
  assert.equal(rememberProblem({ ...text, answerMode: 'value', answer: null }), 'Answer it first.');
  assert.equal(rememberProblem({ ...text, answerMode: 'value', answer: '  ' }), 'Answer it first.');
  assert.equal(rememberProblem({ ...multi, answerMode: 'value', answer: [] }), 'Answer it first.');
  assert.equal(
    rememberProblem({ kind: 'file', options: null, answerMode: 'value', answer: 'file-live' }),
    "File answers can't be remembered.",
  );
  assert.equal(
    rememberProblem({ ...choice, answerMode: 'value', answer: 'Mars' }),
    '"Mars" is not one of the options.',
  );
  assert.equal(
    rememberProblem({ ...choice, answerMode: 'instruction', answer: 'Anywhere warm' }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The review step
// ---------------------------------------------------------------------------

test('questionProgress counts approvals, and splits what is open by required', () => {
  assert.deepEqual(
    questionProgress([
      { required: true, source: 'agent', approvedAt: STAMP },
      { required: true, source: null, approvedAt: null },
      { required: true, source: 'agent', approvedAt: null },
      { required: false, source: null, approvedAt: null },
      { required: false, source: 'profile', approvedAt: new Date(STAMP) },
    ]),
    { approved: 2, total: 5, requiredOpen: 2, optionalOpen: 1, fromSaved: 0 },
  );
  assert.deepEqual(questionProgress([]), {
    approved: 0,
    total: 0,
    requiredOpen: 0,
    optionalOpen: 0,
    fromSaved: 0,
  });
});

test('fromSaved counts the approved answers that came from saved answers', () => {
  const progress = questionProgress([
    { required: true, source: 'saved', approvedAt: STAMP },
    { required: false, source: 'saved', approvedAt: STAMP },
    // Reopened by an edit: still saved, no longer approved.
    { required: true, source: 'saved', approvedAt: null },
    { required: true, source: 'agent', approvedAt: STAMP },
  ]);
  assert.equal(progress.fromSaved, 2);
  assert.equal(progress.approved, 3);
});

test('reviewGroups bulk-approves profile answers, never an EEO one, and keeps order', () => {
  const qs = [
    { id: 'name', source: 'profile', isEeo: false },
    { id: 'why', source: 'agent', isEeo: false },
    { id: 'gender', source: 'profile', isEeo: true },
    { id: 'email', source: 'profile', isEeo: false },
    { id: 'office', source: null, isEeo: false },
    { id: 'veteran', source: 'saved', isEeo: true },
    { id: 'relocate', source: 'saved', isEeo: false },
  ] as const;
  const { profile, saved, rest } = reviewGroups(qs);
  assert.deepEqual(
    profile.map((q) => q.id),
    ['name', 'email'],
  );
  // Saved answers are Chris's own, so an EEO one is among them (C10).
  assert.deepEqual(
    saved.map((q) => q.id),
    ['veteran', 'relocate'],
  );
  assert.deepEqual(
    rest.map((q) => q.id),
    ['why', 'gender', 'office'],
  );
});

test('reopenedQuestions names what lost its approval, and nothing else', () => {
  const before = [
    { id: 'a', approvedAt: STAMP },
    { id: 'b', approvedAt: STAMP },
    { id: 'c', approvedAt: null },
  ];
  assert.deepEqual(
    reopenedQuestions(before, [
      { id: 'a', approvedAt: null },
      { id: 'b', approvedAt: STAMP },
      { id: 'c', approvedAt: null },
      { id: 'd', approvedAt: null },
    ]),
    ['a'],
  );
  // Approving is the other direction.
  assert.deepEqual(
    reopenedQuestions([{ id: 'c', approvedAt: null }], [{ id: 'c', approvedAt: STAMP }]),
    [],
  );
});

test('only non-EEO prose can be sent back for a redraft', () => {
  assert.equal(canRedraft({ kind: 'text', isEeo: false }), true);
  assert.equal(canRedraft({ kind: 'letter', isEeo: false }), true);
  assert.equal(canRedraft({ kind: 'text', isEeo: true }), false);
  for (const kind of ['choice', 'multi', 'bool', 'file'] as const) {
    assert.equal(canRedraft({ kind, isEeo: false }), false, kind);
  }
});

test('wordCount counts words, not whitespace', () => {
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('   '), 0);
  assert.equal(wordCount("I've spent the last\nyear  building tools."), 7);
});
