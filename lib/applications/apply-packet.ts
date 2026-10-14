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
 * Files are paths on the Resumix server, never absolute URLs: a tool has no
 * request to take an origin from, and the agent already reaches the server
 * through its MCP URL (D-050).
 */
import { hasBeenSent } from './status.ts';
import type {
  AnswerMode,
  AnswerValue,
  ApplicationDetail,
  ApplicationFile,
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
  | 'pdfFilenames'
  | 'files'
  | 'questions'
>;

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
 * The approved letter's PDF: the application's earliest non-archived file
 * named like the letter's download (`pdfFilenames.coverLetter`). Final
 * approval archives every earlier one of that name before it stores its own
 * (`recordFinalApproval`), so the earliest left is the one it stored, even
 * if a file of the same name was uploaded by hand since.
 */
export function approvedLetterFile(
  files: readonly ApplicationFile[],
  letterFilename: string,
): ApplicationFile | null {
  let earliest: ApplicationFile | null = null;
  for (const file of files) {
    if (file.isArchived || file.filename !== letterFilename) continue;
    // ISO timestamps compare as strings; the id breaks a tie (D-030).
    const key = `${file.createdAt}|${file.id}`;
    if (earliest === null || key < `${earliest.createdAt}|${earliest.id}`) earliest = file;
  }
  return earliest;
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

/** A Ready application whose approved files can't all be found. Approval
 *  re-stores every one of them, so approving again is the fix. */
function brokenPacket(problems: readonly string[]): string {
  return (
    `This application is Ready, but ${problems.join('; ')}. Nothing was changed. Stop and tell ` +
    'Chris to approve it again.'
  );
}

/**
 * The packet for one application, or why there is none: it is not Ready,
 * or one of the files its approval stored is missing.
 *
 * `resumePdfId` is the pinned snapshot, which the detail names but does not
 * identify. Only a live attachment can be uploaded, so a `file` answer
 * naming an archived or missing one is a problem, as is a linked letter
 * with no approved PDF.
 */
export function buildApplyPacket(
  source: ApplyPacketSource,
  resumePdfId: string | null,
): ApplyPacketResult {
  const refusal = packetRefusal(source.status, source.id);
  if (refusal) return { ok: false, refusal };

  const problems: string[] = [];

  const resume =
    resumePdfId && source.sentPdf
      ? packetFile('resume-pdf', resumePdfId, source.sentPdf.filename)
      : null;
  if (!resume) problems.push('it has no approved resume PDF');

  let coverLetter: ApplyPacketFile | null = null;
  if (source.coverLetterId) {
    const name = source.pdfFilenames.coverLetter;
    const file = name ? approvedLetterFile(source.files, name) : null;
    if (file) coverLetter = packetFile('application-file', file.id, file.filename);
    else
      problems.push(`its approved cover letter PDF (${name ?? 'no name'}) is missing or archived`);
  }

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
    return { ok: false, refusal: brokenPacket(problems) };
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
