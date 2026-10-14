/**
 * Shared wire types. The API speaks camelCase; the database speaks snake_case;
 * Drizzle maps between them. See docs/API.md.
 */

/** The authenticated account. Everything else in this file belongs to exactly
 *  one of these. No password/credential fields — auth is external. */
export interface User {
  id: string;
  email: string;
  name: string | null;
}

/** An API token's metadata (D-039). Deliberately has no field for the secret
 *  or its hash: the secret exists only in `createApiToken`'s return value. */
export interface ApiToken {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Null while the token still works. */
  revokedAt: string | null;
}

/** `GET /api/session` — who the browser is talking as, and how it got there. */
export interface SessionInfo {
  user: User;
  /** 'dev' means the app auto-logged in as the seeded user; see lib/auth-mode.ts. */
  mode: 'dev' | 'password' | 'supabase';
}

export interface Bullet {
  id: string;
  content: string;
  isArchived: boolean;
}

export interface Experience {
  id: string;
  company: string;
  title: string;
  dateRange: string;
  location: string;
  isArchived: boolean;
  bullets: Bullet[];
}

export interface Project {
  id: string;
  name: string;
  technologies: string;
  dateRange: string;
  isArchived: boolean;
  bullets: Bullet[];
}

export interface Skill {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface SkillRow {
  id: string;
  name: string;
  /** true -> top "Technical Skills" section; false -> bottom "Additional Information". */
  top: boolean;
  /** String used to join this row's skills. ', ' for skill lists, ' $|$ ' for interests. */
  separator: string;
  isArchived: boolean;
  skills: Skill[];
}

export interface Template {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  isArchived: boolean;
}

/** Everything that can be put on a resume. */
export interface Library {
  experiences: Experience[];
  projects: Project[];
  skillRows: SkillRow[];
  templates: Template[];
}

/**
 * What a given resume has picked, and in what order. Array position IS sort_order;
 * absence from the array means deselected.
 */
export interface Selections {
  experiences: string[];
  /** experienceId -> ordered bullet ids */
  experienceBullets: Record<string, string[]>;
  projects: string[];
  /** projectId -> ordered bullet ids */
  projectBullets: Record<string, string[]>;
  skillRows: string[];
  /** skillRowId -> ordered skill ids */
  skills: Record<string, string[]>;
}

export const EMPTY_SELECTIONS: Selections = {
  experiences: [],
  experienceBullets: {},
  projects: [],
  projectBullets: {},
  skillRows: [],
  skills: {},
};

export interface ResumeSummary {
  id: string;
  name: string;
  isDefault: boolean;
  templateId: string;
  createdAt: string;
  updatedAt: string;
  latestPdf: { filename: string; createdAt: string } | null;
}

/** One-round-trip payload for the editor page. */
export interface ResumeDetail {
  resume: ResumeSummary;
  template: Template;
  selections: Selections;
  library: Library;
}

export interface RenderResult {
  ok: boolean;
  /** Base64 PDF. Absent when compilation failed. */
  pdfBase64?: string;
  pages: number | null;
  /** LaTeX compile errors. */
  errors: string[];
  /** Renderer-level problems: unknown tokens, headings with no bullets, etc. */
  warnings: string[];
  log: string;
}

// ---------------------------------------------------------------------------
// Cover letters
//
// A cover letter is its text. There is no Selections analogue, no template
// and no PDF snapshot: nothing is shared between letters, so nothing needs
// to be assembled or frozen (D-035).
// ---------------------------------------------------------------------------

/** What the library grid needs — everything but the document itself, which
 *  is large and useless until you open one. */
export interface CoverLetterSummary {
  id: string;
  name: string;
  /** The one new letters are copied from. Exactly one per user. */
  isDefault: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CoverLetter extends CoverLetterSummary {
  /** The whole LaTeX document, raw and unescaped (D-008), or the shell
   *  around its one `%%BODY%%` line. */
  content: string;
  /** The letter's prose as plain text, escaped into the `%%BODY%%` line when
   *  it renders; null for a letter written entirely in LaTeX (D-046). */
  body: string | null;
}

// ---------------------------------------------------------------------------
// Applications
//
// One flat row per application plus untyped attachments — see docs/SCHEMA.md
// and D-032 for why there is no company, event, task or contact type here.
// ---------------------------------------------------------------------------

/** `proposing`, `needs_review` and `ready` are set only by the review flow
 *  (D-041); the rest are the ones a person sets by hand. */
export type ApplicationStatus =
  | 'draft'
  | 'proposing'
  | 'needs_review'
  | 'ready'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected';

/** An attachment's metadata. The bytes are only ever streamed by
 *  `GET /api/application-files/:id`, never carried in a JSON payload. */
export interface ApplicationFile {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  isArchived: boolean;
  createdAt: string;
}

export interface ApplicationSummary {
  id: string;
  company: string;
  roleTitle: string;
  postingUrl: string;
  status: ApplicationStatus;
  /** Null until the application first reaches `applied` or a later stage.
   *  Never cleared, even if the status moves back. */
  appliedAt: string | null;
  /** The live resume this is being tailored from; null if none is linked. */
  resumeId: string | null;
  /** The snapshot that was actually sent. Null until it is marked applied —
   *  and pinned to those bytes forever afterwards, even as `resumeId` moves on. */
  sentPdf: { filename: string; createdAt: string } | null;
  /** This application's own cover letter; null until one is added. Unlike
   *  the resume there is no frozen counterpart — the letter is a private
   *  copy nothing else can edit, so the link is the record (D-035). */
  coverLetterId: string | null;
  /** The agent's 0.0–5.0 estimate of fit; null on anything logged by hand. */
  fitScore: number | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Application questions (D-047): what an application's form asks, and the
// answer Chris approves for each. The vocabularies and their rules are in
// `lib/applications/questions.ts`.

export type QuestionKind = 'text' | 'choice' | 'multi' | 'bool' | 'file' | 'letter';

/** Who proposed the answer. `saved` is a saved answer Chris made earlier. */
export type QuestionSource = 'profile' | 'agent' | 'saved';

/** `instruction` is a choice described in words ("Boston if listed,
 *  otherwise Remote"), for the applying agent to act on (R8). */
export type AnswerMode = 'value' | 'instruction';

/** Where the field is on the form, as discovery read it. */
export interface FieldRef {
  /** 0-based form page. */
  page: number;
  /** The field's visible label, trimmed, with its whitespace collapsed. */
  label: string;
  /** A selector hint for the applying agent; null when there was none. */
  selector: string | null;
}

/** A multi question's value is the options picked; every other answer, an
 *  instruction included, is one string. A file answer is an attachment id. */
export type AnswerValue = string | string[];

export interface ApplicationQuestion {
  id: string;
  prompt: string;
  kind: QuestionKind;
  /** The options a choice or multi question offers; null for every other kind. */
  options: string[] | null;
  fieldRef: FieldRef;
  required: boolean;
  /** An EEO or demographic question. Only Chris answers these (C10). */
  isEeo: boolean;
  /** Null when nothing was proposed. */
  source: QuestionSource | null;
  answerMode: AnswerMode;
  proposedAnswer: AnswerValue | null;
  /** What gets typed into the form. Null until there is one. */
  answer: AnswerValue | null;
  /** Set while Chris has asked the agent for a new draft. */
  redraftNote: string | null;
  /** The saved answer this one is remembered as (D-048): null when there is
   *  none, or when the one it was linked to has since been archived. */
  savedAnswerId: string | null;
  /** Cleared by any change to the answer (C3). */
  approvedAt: string | null;
}

/** An answer Chris ticked "remember" on, for the agent to reuse on a later
 *  form (D-048). Never a file: attachments belong to one application. */
export interface SavedAnswer {
  id: string;
  /** The question's wording when it was first saved. */
  prompt: string;
  kind: QuestionKind;
  answerMode: AnswerMode;
  answer: AnswerValue;
}

/** `GET /api/applications/:id` — the summary plus what the list view has no
 *  use for. */
export interface ApplicationDetail extends ApplicationSummary {
  notes: string;
  /** The posting's text, as the agent captured it. Null when none was. */
  jobDescription: string | null;
  /** The agent's evaluation, as plain text with line breaks. */
  agentSummary: string | null;
  /** The agent's original pick (C7): the review's "agent pick" badges and
   *  "Reset to agent pick". Null when the agent never proposed one. */
  proposedSelection: Selections | null;
  /** Set when Chris approves that section in review; cleared when it changes
   *  afterwards (C3, C11). */
  resumeApprovedAt: string | null;
  coverLetterApprovedAt: string | null;
  /** Set by the final approval that makes it `ready`; cleared with it. */
  approvedAt: string | null;
  /** What final approval names the two PDFs, as the server's prefix makes
   *  them; null for a document that is not linked. */
  pdfFilenames: { resume: string | null; coverLetter: string | null };
  files: ApplicationFile[];
  /** The form's questions, in the order they were added (D-047). */
  questions: ApplicationQuestion[];
}

/** What both `POST /api/applications/:id/pdf` (save the resume to the
 *  application) and `POST /api/applications/:id/apply` return. A LaTeX
 *  failure is `ok: false` and changes nothing, exactly like
 *  `POST /api/resumes/:id/pdf` (docs/API.md). */
export type ApplicationPdfResult =
  | { ok: true; application: ApplicationDetail }
  | { ok: false; pages: number | null; errors: string[]; warnings: string[]; log: string };
