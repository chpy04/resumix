/**
 * Drizzle table definitions. This file and `drizzle/0000_init.sql` must agree
 * exactly — see docs/SCHEMA.md for the frozen contract this implements.
 */

import { eq, isNotNull, relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

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
    uniqueIndex('ux_template_one_default_per_user')
      .on(t.userId)
      .where(eq(t.isDefault, true)),
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
    uniqueIndex('ux_resume_one_default_per_user')
      .on(t.userId)
      .where(eq(t.isDefault, true)),
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
// Relations (used by the query API; harmless if unused by callers)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  templates: many(template),
  experiences: many(experience),
  projects: many(project),
  skillRows: many(technicalSkillRow),
  resumes: many(resume),
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

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;

export type TemplateRecord = typeof template.$inferSelect;
export type NewTemplateRecord = typeof template.$inferInsert;

export type ExperienceRecord = typeof experience.$inferSelect;
export type NewExperienceRecord = typeof experience.$inferInsert;

export type ExperienceBulletRecord = typeof experienceBullet.$inferSelect;
export type NewExperienceBulletRecord = typeof experienceBullet.$inferInsert;

export type ProjectRecord = typeof project.$inferSelect;
export type NewProjectRecord = typeof project.$inferInsert;

export type ProjectBulletRecord = typeof projectBullet.$inferSelect;
export type NewProjectBulletRecord = typeof projectBullet.$inferInsert;

export type TechnicalSkillRowRecord = typeof technicalSkillRow.$inferSelect;
export type NewTechnicalSkillRowRecord = typeof technicalSkillRow.$inferInsert;

export type TechnicalSkillRecord = typeof technicalSkill.$inferSelect;
export type NewTechnicalSkillRecord = typeof technicalSkill.$inferInsert;

export type ResumeRecord = typeof resume.$inferSelect;
export type NewResumeRecord = typeof resume.$inferInsert;

export type ResumeExperienceRecord = typeof resumeExperience.$inferSelect;
export type NewResumeExperienceRecord = typeof resumeExperience.$inferInsert;

export type ResumeExperienceBulletRecord = typeof resumeExperienceBullet.$inferSelect;
export type NewResumeExperienceBulletRecord = typeof resumeExperienceBullet.$inferInsert;

export type ResumeProjectRecord = typeof resumeProject.$inferSelect;
export type NewResumeProjectRecord = typeof resumeProject.$inferInsert;

export type ResumeProjectBulletRecord = typeof resumeProjectBullet.$inferSelect;
export type NewResumeProjectBulletRecord = typeof resumeProjectBullet.$inferInsert;

export type ResumeTechnicalSkillRowRecord = typeof resumeTechnicalSkillRow.$inferSelect;
export type NewResumeTechnicalSkillRowRecord = typeof resumeTechnicalSkillRow.$inferInsert;

export type ResumeTechnicalSkillRecord = typeof resumeTechnicalSkill.$inferSelect;
export type NewResumeTechnicalSkillRecord = typeof resumeTechnicalSkill.$inferInsert;

export type ResumePdfRecord = typeof resumePdf.$inferSelect;
export type NewResumePdfRecord = typeof resumePdf.$inferInsert;
