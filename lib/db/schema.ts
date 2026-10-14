/**
 * Drizzle table definitions. This file and `drizzle/0000_init.sql` must agree
 * exactly — see docs/SCHEMA.md for the frozen contract this implements.
 */

import { eq, isNotNull, relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { FieldRef, Selections } from '../types.ts';

/** Every row gets these; maintained by the shared `set_updated_at()` trigger. */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Every root-level table carries its owner. `restrict`, not `cascade`:
 * content is never deleted (D-011), so deleting a user is a deliberate
 * manual operation rather than something a stray query can trigger.
 */
const owner = {
  userId: uuid('user_id')
    .notNull()
    .references((): AnyPgColumn => users.id, { onDelete: 'restrict' }),
};

/** postgres.js hands bytea columns back as Node `Buffer`s. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ---------------------------------------------------------------------------
// Users
//
// `users`, not `user`: `user` is a reserved word in Postgres. No password
// column — authentication is external (Supabase OAuth); `supabaseUserId` is
// the join key to `auth.users.id` and is null until that is wired up.
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name'),
    supabaseUserId: text('supabase_user_id'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_users_email_lower').on(sql`lower(${t.email})`),
    uniqueIndex('ux_users_supabase_user_id')
      .on(t.supabaseUserId)
      .where(isNotNull(t.supabaseUserId)),
  ],
);

// ---------------------------------------------------------------------------
// Content tables (per-user; a resume may only reference its owner's content)
// ---------------------------------------------------------------------------

export const template = pgTable(
  'template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    content: text('content').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_template_one_default_per_user').on(t.userId).where(eq(t.isDefault, true)),
    index('ix_template_user_id').on(t.userId),
  ],
);

export const experience = pgTable(
  'experience',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    dateRange: text('date_range').notNull(),
    location: text('location').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [index('ix_experience_user_id').on(t.userId)],
);

export const experienceBullet = pgTable(
  'experience_bullet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    experienceId: uuid('experience_id')
      .notNull()
      .references(() => experience.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('ix_experience_bullet_experience_id').on(t.experienceId)],
);

export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    technologies: text('technologies').notNull(),
    dateRange: text('date_range').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [index('ix_project_user_id').on(t.userId)],
);

export const projectBullet = pgTable(
  'project_bullet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('ix_project_bullet_project_id').on(t.projectId)],
);

export const technicalSkillRow = pgTable(
  'technical_skill_row',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    top: boolean('top').notNull().default(true),
    /** Joins this row's skills. ', ' for skill lists, ' $|$ ' for interests. */
    separator: text('separator').notNull().default(', '),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [index('ix_technical_skill_row_user_id').on(t.userId)],
);

export const technicalSkill = pgTable(
  'technical_skill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    technicalSkillRowId: uuid('technical_skill_row_id')
      .notNull()
      .references(() => technicalSkillRow.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('ix_technical_skill_technical_skill_row_id').on(t.technicalSkillRowId)],
);

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export const resume = pgTable(
  'resume',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    templateId: uuid('template_id')
      .notNull()
      .references(() => template.id, { onDelete: 'restrict' }),
    ...owner,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_resume_one_default_per_user').on(t.userId).where(eq(t.isDefault, true)),
    index('ix_resume_template_id').on(t.templateId),
    index('ix_resume_user_id').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Bridge tables — selection *and* ordering.
// Composite PK of the two FKs, `sort_order`, `on delete cascade`, timestamps
// for consistency with every other table.
// ---------------------------------------------------------------------------

export const resumeExperience = pgTable(
  'resume_experience',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    experienceId: uuid('experience_id')
      .notNull()
      .references(() => experience.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.experienceId] })],
);

export const resumeExperienceBullet = pgTable(
  'resume_experience_bullet',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    experienceBulletId: uuid('experience_bullet_id')
      .notNull()
      .references(() => experienceBullet.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.experienceBulletId] })],
);

export const resumeProject = pgTable(
  'resume_project',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.projectId] })],
);

export const resumeProjectBullet = pgTable(
  'resume_project_bullet',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    projectBulletId: uuid('project_bullet_id')
      .notNull()
      .references(() => projectBullet.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.projectBulletId] })],
);

export const resumeTechnicalSkillRow = pgTable(
  'resume_technical_skill_row',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    technicalSkillRowId: uuid('technical_skill_row_id')
      .notNull()
      .references(() => technicalSkillRow.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.technicalSkillRowId] })],
);

export const resumeTechnicalSkill = pgTable(
  'resume_technical_skill',
  {
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    technicalSkillId: uuid('technical_skill_id')
      .notNull()
      .references(() => technicalSkill.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.resumeId, t.technicalSkillId] })],
);

// ---------------------------------------------------------------------------
// PDF snapshots
// ---------------------------------------------------------------------------

export const resumePdf = pgTable(
  'resume_pdf',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resume.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    bytes: bytea('bytes').notNull(),
    byteSize: integer('byte_size').notNull(),
    tex: text('tex').notNull(),
    ...timestamps,
  },
  (t) => [index('ix_resume_pdf_resume_id_created_at').on(t.resumeId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Cover letters
//
// The document *is* the row: `content` holds the whole LaTeX file, verbatim,
// and `body`, when set, the prose that goes at its `%%BODY%%` line (D-046).
// There is no template, no bridge table and no PDF snapshot, because a cover
// letter has none of the sharing a resume has — it is written for one company
// and nothing else can edit it (D-035).
// ---------------------------------------------------------------------------

export const coverLetter = pgTable(
  'cover_letter',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** A complete LaTeX document, raw and unescaped (D-008): the whole
     *  letter, or the shell around its one `%%BODY%%` line. */
    content: text('content').notNull(),
    /** The letter's prose, plain text, escaped into the `%%BODY%%` line when
     *  it renders. Null for a letter written entirely in LaTeX (D-046). */
    body: text('body'),
    isDefault: boolean('is_default').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_cover_letter_one_default_per_user').on(t.userId).where(eq(t.isDefault, true)),
    index('ix_cover_letter_user_id').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// API tokens
//
// The credential `/api/mcp/**` accepts, in every auth mode (D-039). An eighth
// root table. Only the hash is stored, and a token is revoked rather than
// deleted, so the row outlives the secret as a record of who had access.
// ---------------------------------------------------------------------------

export const apiToken = pgTable(
  'api_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    /** Hex sha-256 of the `rmx_…` secret (`lib/api-tokens.ts`). */
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Set once and never cleared. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...owner,
    ...timestamps,
  },
  (t) => [
    uniqueIndex('ux_api_token_token_hash').on(t.tokenHash),
    index('ix_api_token_user_id').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Applications
//
// One row per application, plus its attachments — no company table, no event
// log, no tasks, no contacts (D-032). `application` is a sixth root table and
// carries its owner; `application_file` infers one through its parent, like
// every other non-root table (D-018).
// ---------------------------------------------------------------------------

/** Enum order is the order an application moves through. The three flow
 *  statuses are set only by the review flow, never by hand (D-041). */
export const applicationStatus = pgEnum('application_status', [
  'draft',
  'proposing',
  'needs_review',
  'ready',
  'applied',
  'interviewing',
  'offered',
  'rejected',
]);

export const application = pgTable(
  'application',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    company: text('company').notNull(),
    roleTitle: text('role_title').notNull().default(''),
    postingUrl: text('posting_url').notNull().default(''),
    notes: text('notes').notNull().default(''),
    status: applicationStatus('status').notNull().default('draft'),
    /** Null until the application first reaches `applied` or a later stage;
     *  never stamped by a flow status, never cleared (D-041). */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    /** The live resume being tailored — keeps changing after it is sent. */
    resumeId: uuid('resume_id').references(() => resume.id, { onDelete: 'set null' }),
    /** The immutable snapshot that actually went out; null until applied. */
    resumePdfId: uuid('resume_pdf_id').references(() => resumePdf.id, { onDelete: 'restrict' }),
    /** This application's own cover letter — a private copy, so unlike the
     *  resume it needs no frozen counterpart beside it (D-035). */
    coverLetterId: uuid('cover_letter_id').references(() => coverLetter.id, {
      onDelete: 'set null',
    }),
    // What the agent supplies. Null, not '', when it never supplied one.
    jobDescription: text('job_description'),
    /** The agent's evaluation of the posting, as plain text. */
    agentSummary: text('agent_summary'),
    /** 0.0–5.0, one decimal place (C13). `mode: 'number'` is the one place
     *  postgres.js's numeric string becomes a number. */
    fitScore: numeric('fit_score', { precision: 2, scale: 1, mode: 'number' }),
    /** The agent's original pick, so the review can reset to it (C7). */
    proposedSelection: jsonb('proposed_selection').$type<Selections>(),
    // Approval stamps, null until a human approves that part (C11).
    resumeApprovedAt: timestamp('resume_approved_at', { withTimezone: true }),
    coverLetterApprovedAt: timestamp('cover_letter_approved_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [
    index('ix_application_user_id').on(t.userId),
    index('ix_application_resume_id').on(t.resumeId),
    index('ix_application_resume_pdf_id').on(t.resumePdfId),
    index('ix_application_cover_letter_id').on(t.coverLetterId),
    check('ck_application_fit_score', sql`${t.fitScore} between 0 and 5`),
  ],
);

export const applicationFile = pgTable(
  'application_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    byteSize: integer('byte_size').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('ix_application_file_application_id').on(t.applicationId, t.createdAt.desc())],
);

// ---------------------------------------------------------------------------
// Application questions (D-047)
//
// What an application's form asks, and the answer Chris approves for each.
// Owned through `application_id`, like `application_file`. The CHECKs are
// the rules a write must never get past, C10's among them; the answer
// encoding they rely on is in `lib/applications/questions.ts`.
// ---------------------------------------------------------------------------

export const applicationQuestionKind = pgEnum('application_question_kind', [
  'text',
  'choice',
  'multi',
  'bool',
  'file',
  'letter',
]);

export const applicationQuestionSource = pgEnum('application_question_source', [
  'profile',
  'agent',
  'saved',
]);

/** Not prefixed with the table: saved answers reuse it. */
export const answerMode = pgEnum('answer_mode', ['value', 'instruction']);

export const applicationQuestion = pgTable(
  'application_question',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => application.id, { onDelete: 'cascade' }),
    /** Dense, in the order the questions were added. */
    sortOrder: integer('sort_order').notNull(),
    prompt: text('prompt').notNull(),
    kind: applicationQuestionKind('kind').notNull(),
    /** Choice and multi only. */
    options: jsonb('options').$type<string[]>(),
    fieldRef: jsonb('field_ref').$type<FieldRef>().notNull(),
    required: boolean('required').notNull(),
    isEeo: boolean('is_eeo').notNull().default(false),
    /** Who proposed the answer; null when nothing was. */
    source: applicationQuestionSource('source'),
    answerMode: answerMode('answer_mode').notNull().default('value'),
    proposedAnswer: text('proposed_answer'),
    answer: text('answer'),
    /** Non-null while Chris has asked the agent for a new draft. */
    redraftNote: text('redraft_note'),
    /** The saved answer this one was filled from or is remembered as. The
     *  question holds its own copy of the answer, so `set null` loses
     *  nothing. */
    savedAnswerId: uuid('saved_answer_id').references((): AnyPgColumn => savedAnswer.id, {
      onDelete: 'set null',
    }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('ix_application_question_saved_answer_id').on(t.savedAnswerId),
    uniqueIndex('ux_application_question_field').on(
      t.applicationId,
      sql`(${t.fieldRef} ->> 'page')`,
      sql`lower(regexp_replace(btrim(${t.fieldRef} ->> 'label'), '\s+', ' ', 'g'))`,
    ),
    check(
      'ck_application_question_options',
      sql`(${t.options} is not null) = (${t.kind} in ('choice', 'multi'))`,
    ),
    check(
      'ck_application_question_instruction',
      sql`${t.answerMode} = 'value' or ${t.kind} in ('choice', 'multi')`,
    ),
    check(
      'ck_application_question_proposal',
      sql`(${t.source} is null) = (${t.proposedAnswer} is null)`,
    ),
    check(
      'ck_application_question_eeo',
      sql`not ${t.isEeo} or ${t.source} is null or ${t.source} = 'saved'`,
    ),
    check(
      'ck_application_question_approved_answer',
      sql`${t.approvedAt} is null or ${t.answer} is not null`,
    ),
    check(
      'ck_application_question_redraft',
      sql`${t.redraftNote} is null or ${t.approvedAt} is null`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Saved answers (D-048)
//
// Chris's answers to the questions forms keep asking, for the agent to link
// to the next form that asks. A ninth root table. Archived, never deleted;
// `kind` is stored so an answer's encoding can be read, `options` is not,
// because the question it is linked to supplies them.
// ---------------------------------------------------------------------------

export const savedAnswer = pgTable(
  'saved_answer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The question's wording when it was first saved. */
    prompt: text('prompt').notNull(),
    kind: applicationQuestionKind('kind').notNull(),
    answerMode: answerMode('answer_mode').notNull().default('value'),
    /** Encoded as an `application_question` answer of the same kind. */
    answer: text('answer').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    ...owner,
    ...timestamps,
  },
  (t) => [
    index('ix_saved_answer_user_id').on(t.userId),
    check('ck_saved_answer_kind', sql`${t.kind} <> 'file'`),
    check(
      'ck_saved_answer_mode',
      sql`${t.answerMode} = 'value' or ${t.kind} in ('choice', 'multi')`,
    ),
    check('ck_saved_answer_answer', sql`btrim(${t.answer}) <> ''`),
  ],
);

// ---------------------------------------------------------------------------
// Relations (used by the query API; harmless if unused by callers)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  templates: many(template),
  experiences: many(experience),
  projects: many(project),
  skillRows: many(technicalSkillRow),
  resumes: many(resume),
  coverLetters: many(coverLetter),
}));

export const experienceRelations = relations(experience, ({ many, one }) => ({
  bullets: many(experienceBullet),
  user: one(users, { fields: [experience.userId], references: [users.id] }),
}));

export const experienceBulletRelations = relations(experienceBullet, ({ one }) => ({
  experience: one(experience, {
    fields: [experienceBullet.experienceId],
    references: [experience.id],
  }),
}));

export const projectRelations = relations(project, ({ many }) => ({
  bullets: many(projectBullet),
}));

export const projectBulletRelations = relations(projectBullet, ({ one }) => ({
  project: one(project, {
    fields: [projectBullet.projectId],
    references: [project.id],
  }),
}));

export const technicalSkillRowRelations = relations(technicalSkillRow, ({ many }) => ({
  skills: many(technicalSkill),
}));

export const technicalSkillRelations = relations(technicalSkill, ({ one }) => ({
  row: one(technicalSkillRow, {
    fields: [technicalSkill.technicalSkillRowId],
    references: [technicalSkillRow.id],
  }),
}));

export const resumeRelations = relations(resume, ({ one, many }) => ({
  template: one(template, { fields: [resume.templateId], references: [template.id] }),
  pdfs: many(resumePdf),
}));

export const resumePdfRelations = relations(resumePdf, ({ one }) => ({
  resume: one(resume, { fields: [resumePdf.resumeId], references: [resume.id] }),
}));

export const applicationRelations = relations(application, ({ one, many }) => ({
  resume: one(resume, { fields: [application.resumeId], references: [resume.id] }),
  sentPdf: one(resumePdf, { fields: [application.resumePdfId], references: [resumePdf.id] }),
  coverLetter: one(coverLetter, {
    fields: [application.coverLetterId],
    references: [coverLetter.id],
  }),
  files: many(applicationFile),
  questions: many(applicationQuestion),
}));

export const applicationFileRelations = relations(applicationFile, ({ one }) => ({
  application: one(application, {
    fields: [applicationFile.applicationId],
    references: [application.id],
  }),
}));

export const applicationQuestionRelations = relations(applicationQuestion, ({ one }) => ({
  application: one(application, {
    fields: [applicationQuestion.applicationId],
    references: [application.id],
  }),
}));
