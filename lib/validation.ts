/**
 * zod request-body schemas. Every route handler parses its body through one
 * of these and returns `400 { error }` on failure — see docs/API.md.
 */
import { z } from 'zod';

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export const createResumeSchema = z.object({
  name: nonEmpty,
});

export const patchResumeSchema = z
  .object({
    name: nonEmpty.optional(),
    templateId: uuid.optional(),
  })
  .refine((body) => body.name !== undefined || body.templateId !== undefined, {
    message: 'at least one of name or templateId is required',
  });

// ---------------------------------------------------------------------------
// Selections (autosave)
// ---------------------------------------------------------------------------

const idArray = z.array(uuid);
const idArrayMap = z.record(uuid, idArray);

export const selectionsPatchSchema = z
  .object({
    experiences: idArray.optional(),
    experienceBullets: idArrayMap.optional(),
    projects: idArray.optional(),
    projectBullets: idArrayMap.optional(),
    skillRows: idArray.optional(),
    skills: idArrayMap.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one selection slice is required',
  });

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const renderBodySchema = z.object({
  templateOverride: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Library: experiences
// ---------------------------------------------------------------------------

export const createExperienceSchema = z.object({
  company: nonEmpty,
  title: nonEmpty,
  dateRange: nonEmpty,
  location: nonEmpty,
});

export const patchExperienceSchema = z
  .object({
    company: nonEmpty.optional(),
    title: nonEmpty.optional(),
    dateRange: nonEmpty.optional(),
    location: nonEmpty.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const createBulletSchema = z.object({
  content: nonEmpty,
});

export const patchBulletSchema = z
  .object({
    content: nonEmpty.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

// ---------------------------------------------------------------------------
// Library: projects
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: nonEmpty,
  technologies: nonEmpty,
  dateRange: nonEmpty,
});

export const patchProjectSchema = z
  .object({
    name: nonEmpty.optional(),
    technologies: nonEmpty.optional(),
    dateRange: nonEmpty.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

// ---------------------------------------------------------------------------
// Library: technical skills
// ---------------------------------------------------------------------------

export const createSkillRowSchema = z.object({
  name: nonEmpty,
  top: z.boolean(),
  separator: z.string().min(1).optional(),
});

export const patchSkillRowSchema = z
  .object({
    name: nonEmpty.optional(),
    top: z.boolean().optional(),
    separator: z.string().min(1).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const createSkillSchema = z.object({
  name: nonEmpty,
});

export const patchSkillSchema = z
  .object({
    name: nonEmpty.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const patchTemplateSchema = z
  .object({
    name: nonEmpty.optional(),
    content: z.string().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

// ---------------------------------------------------------------------------
// Feedback (in-app "Give feedback" widget → GitHub issue)
// ---------------------------------------------------------------------------

/** Only http(s): the page URL is echoed into markdown, so `javascript:` and
 *  friends have no business being there. */
const pageUrl = z.string().refine(
  (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an http(s) URL' },
);

export const feedbackSchema = z.object({
  kind: z.enum(['bug', 'feature']),
  description: nonEmpty.max(10_000),
  url: pageUrl,
  viewport: z.string().max(40).optional(),
  userAgent: z.string().max(500).optional(),
});
