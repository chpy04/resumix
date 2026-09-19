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
