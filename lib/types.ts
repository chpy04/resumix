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

/**
 * A change to the bullets the agent proposed for one application, which only
 * Chris's click in review applies (D-045). The agent never writes to the
 * library: an edit names a bullet and the text it would read, an addition
 * names a parent and a slot.
 */
export interface BulletSuggestion {
  id: string;
  kind: 'edit' | 'add';
  /** Which pair of tables `bulletId` and `parentId` point into. */
  bulletKind: 'experience' | 'project';
  /** The bullet an edit changes; null on an addition. */
  bulletId: string | null;
  /** The experience or project an addition goes under; null on an edit. */
  parentId: string | null;
  /** An addition's slot among the parent's bullets this resume shows: 0 is
   *  first, and anything past the last is last. Null on an edit. */
  position: number | null;
  /** Plain text, one line. Escaped on its way into LaTeX, never stored as it. */
  proposedText: string;
  rationale: string;
  /** `applied` (Apply to bullet, or Add bullet), `copied` (Save as new). */
  status: 'pending' | 'applied' | 'copied' | 'rejected';
  createdAt: string;
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
}

/** What both `POST /api/applications/:id/pdf` (save the resume to the
 *  application) and `POST /api/applications/:id/apply` return. A LaTeX
 *  failure is `ok: false` and changes nothing, exactly like
 *  `POST /api/resumes/:id/pdf` (docs/API.md). */
export type ApplicationPdfResult =
  | { ok: true; application: ApplicationDetail }
  | { ok: false; pages: number | null; errors: string[]; warnings: string[]; log: string };
