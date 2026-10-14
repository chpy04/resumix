import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFilePath,
  approvedLetterFile,
  buildApplyPacket,
  packetFileRefs,
  packetHasFile,
  packetRefusal,
  type ApplyPacket,
  type ApplyPacketSource,
} from './apply-packet.ts';
import { APPLICATION_STATUSES } from './status.ts';
import type { ApplicationFile, ApplicationQuestion } from '../types.ts';

const STAMP = '2026-10-13T10:00:00.000Z';
const APP_ID = '5b7e0000-0000-4000-8000-000000000001';
const PDF_ID = '91c00000-0000-4000-8000-000000000002';
const LETTER_NAME = 'Chris_Pyle_Halcyon_Cover_Letter.pdf';

function file(overrides: Partial<ApplicationFile> = {}): ApplicationFile {
  return {
    id: 'f0000000-0000-4000-8000-000000000001',
    filename: LETTER_NAME,
    contentType: 'application/pdf',
    byteSize: 10,
    isArchived: false,
    createdAt: STAMP,
    ...overrides,
  };
}

const LETTER = file();
const SAMPLE = file({
  id: 'f0000000-0000-4000-8000-000000000002',
  filename: 'take-home.pdf',
  createdAt: '2026-10-12T09:00:00.000Z',
});

function question(overrides: Partial<ApplicationQuestion> = {}): ApplicationQuestion {
  return {
    id: 'q0000000-0000-4000-8000-000000000001',
    prompt: 'Why Halcyon?',
    kind: 'text',
    options: null,
    fieldRef: { page: 0, label: 'Why Halcyon?', selector: 'role=textbox[name="Why Halcyon?"]' },
    required: true,
    isEeo: false,
    source: 'agent',
    answerMode: 'value',
    proposedAnswer: 'Because.',
    answer: 'Because freight.',
    redraftNote: null,
    savedAnswerId: null,
    approvedAt: STAMP,
    ...overrides,
  };
}

function source(overrides: Partial<ApplyPacketSource> = {}): ApplyPacketSource {
  return {
    id: APP_ID,
    status: 'ready',
    company: 'Halcyon Freight',
    roleTitle: 'SWE Intern',
    postingUrl: 'https://jobs.example.test/halcyon/1',
    approvedAt: STAMP,
    coverLetterId: 'c0000000-0000-4000-8000-000000000001',
    sentPdf: { filename: 'Chris_Pyle_Halcyon_Freight_Resume.pdf', createdAt: STAMP },
    pdfFilenames: { resume: 'Chris_Pyle_Halcyon_Freight_Resume.pdf', coverLetter: LETTER_NAME },
    files: [LETTER, SAMPLE],
    questions: [question()],
    ...overrides,
  };
}

function packetOf(s: ApplyPacketSource): ApplyPacket {
  const result = buildApplyPacket(s, PDF_ID);
  assert.ok(result.ok, result.ok ? '' : result.refusal);
  return result.packet;
}

function refusalOf(s: ApplyPacketSource, resumePdfId: string | null = PDF_ID): string {
  const result = buildApplyPacket(s, resumePdfId);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.refusal;
}

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------

test('a ready application gives its posting, both PDFs and every question', () => {
  const packet = packetOf(source());
  assert.deepEqual(
    { ...packet, questions: packet.questions.length },
    {
      applicationId: APP_ID,
      company: 'Halcyon Freight',
      roleTitle: 'SWE Intern',
      postingUrl: 'https://jobs.example.test/halcyon/1',
      approvedAt: STAMP,
      resume: {
        kind: 'resume-pdf',
        id: PDF_ID,
        filename: 'Chris_Pyle_Halcyon_Freight_Resume.pdf',
        url: `/api/mcp/files/resume-pdf/${PDF_ID}`,
      },
      coverLetter: {
        kind: 'application-file',
        id: LETTER.id,
        filename: LETTER_NAME,
        url: `/api/mcp/files/application-file/${LETTER.id}`,
      },
      questions: 1,
    },
  );
});

test('an approved text answer is its value, with its mode and field_ref', () => {
  const [q] = packetOf(source()).questions;
  assert.deepEqual(q, {
    questionId: 'q0000000-0000-4000-8000-000000000001',
    fieldRef: { page: 0, label: 'Why Halcyon?', selector: 'role=textbox[name="Why Halcyon?"]' },
    prompt: 'Why Halcyon?',
    kind: 'text',
    options: null,
    required: true,
    isEeo: false,
    approved: true,
    answerMode: 'value',
    answer: 'Because freight.',
    file: null,
  });
});

test('an unapproved question is listed, with no answer and no mode', () => {
  const [q] = packetOf(
    source({ questions: [question({ required: false, approvedAt: null })] }),
  ).questions;
  assert.equal(q?.approved, false);
  assert.equal(q?.answer, null);
  assert.equal(q?.answerMode, null);
  assert.equal(q?.file, null);
});

test('an instruction is its words, and a multi value is its picks', () => {
  const offices = ['NYC', 'Boston', 'Remote'];
  const [instruction, multi, bool] = packetOf(
    source({
      questions: [
        question({
          kind: 'choice',
          options: offices,
          answerMode: 'instruction',
          answer: 'Boston if listed, otherwise Remote',
        }),
        question({ kind: 'multi', options: offices, answer: ['NYC', 'Remote'] }),
        question({ kind: 'bool', answer: 'yes' }),
      ],
    }),
  ).questions;
  assert.deepEqual(
    [instruction?.answerMode, instruction?.answer],
    ['instruction', 'Boston if listed, otherwise Remote'],
  );
  assert.deepEqual([multi?.answerMode, multi?.answer], ['value', ['NYC', 'Remote']]);
  assert.equal(bool?.answer, 'yes');
});

test('an approved EEO answer is Chris’s, and is filled like any other', () => {
  const [q] = packetOf(
    source({
      questions: [
        question({
          kind: 'choice',
          options: ['Decline to answer', 'Male'],
          isEeo: true,
          source: null,
          answer: 'Decline to answer',
        }),
      ],
    }),
  ).questions;
  assert.deepEqual([q?.isEeo, q?.answer], [true, 'Decline to answer']);
});

test('a file answer is the attachment it picked, never the id as an answer', () => {
  const [q] = packetOf(
    source({ questions: [question({ kind: 'file', source: null, answer: SAMPLE.id })] }),
  ).questions;
  assert.equal(q?.answer, null);
  assert.equal(q?.answerMode, 'value');
  assert.deepEqual(q?.file, {
    kind: 'application-file',
    id: SAMPLE.id,
    filename: 'take-home.pdf',
    url: applyFilePath('application-file', SAMPLE.id),
  });
});

test('with no letter linked, there is no letter', () => {
  const packet = packetOf(
    source({ coverLetterId: null, pdfFilenames: { resume: 'r.pdf', coverLetter: null } }),
  );
  assert.equal(packet.coverLetter, null);
});

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

test('a linked letter whose approved PDF is gone is refused', () => {
  for (const files of [[], [file({ isArchived: true })], [file({ filename: 'Other.pdf' })]]) {
    assert.equal(
      refusalOf(source({ files })),
      `This application is Ready, but its approved cover letter PDF (${LETTER_NAME}) is missing ` +
        'or archived. Nothing was changed. Stop and tell Chris to approve it again.',
    );
  }
});

test('a file answer naming a missing or archived attachment is refused', () => {
  for (const files of [[LETTER], [LETTER, { ...SAMPLE, isArchived: true }]]) {
    assert.equal(
      refusalOf(
        source({
          files,
          questions: [question({ kind: 'file', prompt: 'Writing sample', answer: SAMPLE.id })],
        }),
      ),
      'This application is Ready, but the attachment picked for "Writing sample" is missing or ' +
        'archived. Nothing was changed. Stop and tell Chris to approve it again.',
    );
  }
});

test('a missing resume snapshot is refused, and every problem is named at once', () => {
  assert.equal(
    refusalOf(source({ files: [] }), null),
    'This application is Ready, but it has no approved resume PDF; its approved cover letter ' +
      `PDF (${LETTER_NAME}) is missing or archived. Nothing was changed. Stop and tell Chris to ` +
      'approve it again.',
  );
  assert.match(refusalOf(source({ sentPdf: null })), /it has no approved resume PDF/);
});

test('an unapproved file question needs no attachment', () => {
  const [q] = packetOf(
    source({
      files: [LETTER],
      questions: [question({ kind: 'file', answer: null, approvedAt: null })],
    }),
  ).questions;
  assert.equal(q?.file, null);
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

test('only a Ready application has a packet, and each refusal says what to do', () => {
  assert.equal(packetRefusal('ready', APP_ID), null);
  assert.equal(
    packetRefusal('proposing', APP_ID),
    'This application is still proposing: nothing is approved to fill. Nothing was changed. ' +
      'Stop and tell Chris.',
  );
  assert.equal(
    packetRefusal('needs_review', APP_ID),
    "This application is in Needs review: Chris hasn't approved it, or it was reopened. Nothing " +
      `was changed. Stop and tell Chris to approve it at /applications/${APP_ID}/review.`,
  );
  assert.equal(
    packetRefusal('draft', APP_ID),
    'This application was logged by hand and has no approved packet. Nothing was changed. Stop.',
  );
  for (const status of ['applied', 'interviewing', 'offered', 'rejected'] as const) {
    assert.equal(
      packetRefusal(status, APP_ID),
      `This application is already ${status}: it has been sent. Don't fill the form again. Stop.`,
    );
  }
  for (const status of APPLICATION_STATUSES) {
    const result = buildApplyPacket(source({ status }), PDF_ID);
    assert.equal(result.ok, status === 'ready', status);
    if (!result.ok) assert.equal(result.refusal, packetRefusal(status, APP_ID), status);
  }
});

// ---------------------------------------------------------------------------
// The approved letter, and the file set
// ---------------------------------------------------------------------------

test('the approved letter is the earliest live file of its name', () => {
  const approved = file({ id: 'f0000000-0000-4000-8000-00000000000a', createdAt: STAMP });
  const uploadedSince = file({
    id: 'f0000000-0000-4000-8000-00000000000b',
    createdAt: '2026-10-14T10:00:00.000Z',
  });
  const archived = file({
    id: 'f0000000-0000-4000-8000-00000000000c',
    createdAt: '2026-10-01T10:00:00.000Z',
    isArchived: true,
  });
  // Newest first, as `listApplicationFiles` orders them.
  assert.equal(approvedLetterFile([uploadedSince, approved, archived], LETTER_NAME), approved);
  assert.equal(approvedLetterFile([archived], LETTER_NAME), null);
  assert.equal(approvedLetterFile([SAMPLE], LETTER_NAME), null);
});

test('the file set is the resume, the letter and each picked attachment, and nothing else', () => {
  const packet = packetOf(
    source({
      questions: [question(), question({ kind: 'file', answer: SAMPLE.id })],
    }),
  );
  assert.deepEqual(packetFileRefs(packet), [
    { kind: 'resume-pdf', id: PDF_ID },
    { kind: 'application-file', id: LETTER.id },
    { kind: 'application-file', id: SAMPLE.id },
  ]);
  assert.ok(packetHasFile(packet, { kind: 'application-file', id: SAMPLE.id }));
  // The same id under the other kind is not in it.
  assert.ok(!packetHasFile(packet, { kind: 'resume-pdf', id: SAMPLE.id }));

  const unpicked = packetOf(source());
  assert.ok(!packetHasFile(unpicked, { kind: 'application-file', id: SAMPLE.id }));
});
