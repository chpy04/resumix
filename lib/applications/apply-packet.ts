/**
 * The apply packet: exactly what Chris approved, as the agent fills it into
 * the real form (C4, D-050). Pure, like `review.ts` — `get_apply_packet`
 * returns what this builds, and the files route serves only the files it
 * names, so "what the agent may fetch" and "what the agent is told to
 * upload" are one rule.
 *
 * Every question is listed, approved or not. One left unapproved (only an
 * optional one can be, on a Ready application) has no answer, which tells
 * the agent to leave the field blank; listing it still marks the field as
 * seen, so the apply pass never reports it as new.
 *
 * The two PDFs are the ones final approval pinned, by id: `resume_pdf_id`
 * and `cover_letter_pdf_id`. Nothing is found by name, so renaming the
 * letter, or taking an older copy out of the archive, never changes what is
 * sent, and a pinned file is sent even once archived, as whatever pinned
 * content keeps it (D-011).
 *
 * Files are paths on the Resumix server, never absolute URLs: a tool has no
 * request to take an origin from, and the agent already reaches the server
 * through its MCP URL (D-050).
 */
import { hasBeenSent } from './status.ts';
import type {
  AnswerMode,
  AnswerValue,
  ApplicationDetail,
  ApplicationStatus,
  FieldRef,
  QuestionKind,
} from '../types.ts';

/** The two places a packet file comes from: the pinned `resume_pdf`
 *  snapshot, and the application's attachments (the approved letter, and
 *  whatever a `file` question picked). */
export type ApplyFileKind = 'resume-pdf' | 'application-file';

export interface ApplyFileRef {
  kind: ApplyFileKind;
  id: string;
}

/** A file the agent downloads and uploads: the name to save it under, and
 *  where to fetch it. */
export interface ApplyPacketFile extends ApplyFileRef {
  filename: string;
  url: string;
}

export interface ApplyPacketQuestion {
  questionId: string;
  fieldRef: FieldRef;
  prompt: string;
  kind: QuestionKind;
  options: string[] | null;
  required: boolean;
  isEeo: boolean;
  approved: boolean;
  /** Null, with `answer`, when the question is not approved. */
  answerMode: AnswerMode | null;
  /** The approved answer, decoded: a multi value is its picks, an
   *  instruction its words. Null when not approved, and for a `file`
   *  question, whose answer is `file`. */
  answer: AnswerValue | null;
  file: ApplyPacketFile | null;
}

export interface ApplyPacket {
  applicationId: string;
  company: string;
  roleTitle: string;
  postingUrl: string;
  approvedAt: string;
  resume: ApplyPacketFile;
  coverLetter: ApplyPacketFile | null;
  questions: ApplyPacketQuestion[];
}

/** What the packet is built from: the application as `getApplicationDetail`
 *  reads it. */
export type ApplyPacketSource = Pick<
  ApplicationDetail,
  | 'id'
  | 'status'
  | 'company'
  | 'roleTitle'
  | 'postingUrl'
  | 'approvedAt'
  | 'coverLetterId'
  | 'sentPdf'
  | 'files'
  | 'questions'
>;

/** The PDFs final approval pinned. The row holds both ids; the detail only
 *  names the resume's. */
export interface ApprovedPdfs {
  resumePdfId: string | null;
  coverLetterPdfId: string | null;
}

export type ApplyPacketResult = { ok: true; packet: ApplyPacket } | { ok: false; refusal: string };

/** Where the agent fetches one packet file, with the same bearer token as
 *  `/api/mcp` (C5). */
export function applyFilePath(kind: ApplyFileKind, id: string): string {
  return `/api/mcp/files/${kind}/${id}`;
}

function packetFile(kind: ApplyFileKind, id: string, filename: string): ApplyPacketFile {
  return { kind, id, filename, url: applyFilePath(kind, id) };
}

/**
 * Why there is no packet for an application in `status`, or null when it
 * is Ready. Each text says what the agent should do next (C1): only a Ready
 * application has anything approved to fill.
 */
export function packetRefusal(status: ApplicationStatus, applicationId: string): string | null {
  if (status === 'ready') return null;
  if (status === 'proposing') {
    return (
      'This application is still proposing: nothing is approved to fill. Nothing was changed. ' +
      'Stop and tell Chris.'
    );
  }
  if (status === 'needs_review') {
    return (
      "This application is in Needs review: Chris hasn't approved it, or it was reopened. " +
      `Nothing was changed. Stop and tell Chris to approve it at /applications/${applicationId}/review.`
    );
  }
  if (hasBeenSent(status)) {
    return `This application is already ${status}: it has been sent. Don't fill the form again. Stop.`;
  }
  return 'This application was logged by hand and has no approved packet. Nothing was changed. Stop.';
}

/**
 * A Ready application whose packet can't be built. A Ready application
 * can't be approved again as it stands, but any edit in its review sends it
 * back to Needs review, and the next final approval pins everything afresh.
 */
function brokenPacket(problems: readonly string[], applicationId: string): string {
  return (
    `This application is Ready, but ${problems.join('; ')}. Nothing was changed. Stop and tell ` +
    'Chris it changed after it was approved: any edit in its review at ' +
    `/applications/${applicationId}/review sends it back to Needs review, and then he can ` +
    'approve it again.'
  );
}

/**
 * The packet for one application, or why there is none: it is not Ready,
 * or something its approval pinned or picked can't be found.
 *
 * A `file` answer names an attachment Chris picked, not one approval
 * pinned, so it must still be live: archiving one unapproves its question
 * and reopens the application (D-047), and a Ready one naming an archived
 * or missing attachment is a problem. So is a linked letter with no pinned
 * PDF, which only an approval made before the pointer existed leaves.
 */
export function buildApplyPacket(source: ApplyPacketSource, pdfs: ApprovedPdfs): ApplyPacketResult {
  const refusal = packetRefusal(source.status, source.id);
  if (refusal) return { ok: false, refusal };

  const problems: string[] = [];

  const resume =
    pdfs.resumePdfId && source.sentPdf
      ? packetFile('resume-pdf', pdfs.resumePdfId, source.sentPdf.filename)
      : null;
  if (!resume) problems.push('it has no approved resume PDF');

  // Archived or not: the pin is what was approved (D-011).
  const letterFile = pdfs.coverLetterPdfId
    ? source.files.find((f) => f.id === pdfs.coverLetterPdfId)
    : undefined;
  const coverLetter = letterFile
    ? packetFile('application-file', letterFile.id, letterFile.filename)
    : null;
  if (source.coverLetterId && !coverLetter) problems.push('its cover letter has no approved PDF');

  const questions = source.questions.map((q): ApplyPacketQuestion => {
    const approved = q.approvedAt !== null;
    let file: ApplyPacketFile | null = null;
    if (approved && q.kind === 'file') {
      const picked = source.files.find((f) => f.id === q.answer && !f.isArchived);
      if (picked) file = packetFile('application-file', picked.id, picked.filename);
      else problems.push(`the attachment picked for "${q.prompt}" is missing or archived`);
    }
    return {
      questionId: q.id,
      fieldRef: q.fieldRef,
      prompt: q.prompt,
      kind: q.kind,
      options: q.options,
      required: q.required,
      isEeo: q.isEeo,
      approved,
      answerMode: approved ? q.answerMode : null,
      answer: approved && q.kind !== 'file' ? q.answer : null,
      file,
    };
  });

  // Set exactly when the status is Ready (docs/SCHEMA.md); checked, not assumed.
  if (!source.approvedAt) problems.push('it has no final approval');
  if (problems.length > 0 || !resume || !source.approvedAt) {
    return { ok: false, refusal: brokenPacket(problems, source.id) };
  }

  return {
    ok: true,
    packet: {
      applicationId: source.id,
      company: source.company,
      roleTitle: source.roleTitle,
      postingUrl: source.postingUrl,
      approvedAt: source.approvedAt,
      resume,
      coverLetter,
      questions,
    },
  };
}

/** Every file a packet names: the set the files route serves from, and
 *  nothing outside it. */
export function packetFileRefs(packet: ApplyPacket): ApplyFileRef[] {
  const files = [
    packet.resume,
    ...(packet.coverLetter ? [packet.coverLetter] : []),
    ...packet.questions.flatMap((q) => (q.file ? [q.file] : [])),
  ];
  return files.map(({ kind, id }) => ({ kind, id }));
}

/** Whether `ref` is one of the files `packet` names. */
export function packetHasFile(packet: ApplyPacket, ref: ApplyFileRef): boolean {
  return packetFileRefs(packet).some((file) => file.kind === ref.kind && file.id === ref.id);
}
