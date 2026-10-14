/**
 * zod request-body schemas. Every route handler parses its body through one
 * of these and returns `400 { error }` on failure — see docs/API.md.
 */
import { z } from 'zod';
import { ANSWER_MODES } from './applications/questions.ts';
import { MANUAL_STATUSES } from './applications/status.ts';

const uuid = z.string().uuid();
const nonEmpty = z.string().trim().min(1);

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Messages are spelled out because `parseJsonBody` renders them as
 *  `<field>: <message>`, and zod's default "Too small" wording is useless
 *  to a caller. */
export const loginSchema = z.object({
  password: z.string('is required').min(1, 'is required'),
});

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
  /** Lay this application's pending bullet suggestions over the preview
   *  (D-045). The application must send this resume. */
  suggestionsFor: uuid.optional(),
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
// Cover letters
//
// `content` may be empty: a letter you have cleared out to start over is a
// normal editor state, and an empty document simply fails to compile the
// same way a broken one does. So may `body`, which prints as nothing; it is
// never null, because nothing turns a letter back into LaTeX only (D-046).
// `isDefault` is absent on purpose — see `updateCoverLetter`.
// ---------------------------------------------------------------------------

export const createCoverLetterSchema = z.object({
  name: nonEmpty,
  /** Copy this letter instead of the default. */
  sourceCoverLetterId: uuid.nullable().optional(),
});

export const patchCoverLetterSchema = z
  .object({
    name: nonEmpty.optional(),
    content: z.string().optional(),
    body: z.string().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

/** The editor previews what is on screen, which is not yet what is stored —
 *  the same trick `renderBodySchema` plays with `templateOverride`. */
export const renderCoverLetterSchema = z.object({
  contentOverride: z.string().optional(),
  bodyOverride: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Applications
//
// Everything but the company is optional and may be empty: an application is
// logged the moment you see a posting, and filled in from there (D-032).
// `appliedAt` is deliberately absent — it follows from `status`, and is set
// by the query layer (`lib/applications/status.ts`). So are the agent's
// fields (`jobDescription`, `agentSummary`, `fitScore`): they arrive with
// the application from the agent, and the UI only shows them.
// ---------------------------------------------------------------------------

/** Empty (not yet known) or a real http(s) link — it is rendered as an `href`. */
const optionalUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || isHttpUrl(value), { message: 'must be an http(s) URL' });

export const createApplicationSchema = z
  .object({
    company: nonEmpty,
    roleTitle: z.string().trim().optional(),
    postingUrl: optionalUrl.optional(),
    /** Link a resume that already exists. */
    resumeId: uuid.nullable().optional(),
    /** Clone this resume under the company's name and link that instead —
     *  the normal path, since a new application comes with its own resume. */
    createResumeFrom: uuid.nullable().optional(),
  })
  .refine((body) => !(body.resumeId && body.createResumeFrom), {
    message: 'pass either resumeId or createResumeFrom, not both',
  });

export const patchApplicationSchema = z
  .object({
    company: nonEmpty.optional(),
    roleTitle: z.string().trim().optional(),
    postingUrl: optionalUrl.optional(),
    notes: z.string().optional(),
    /** Manual statuses only. `ready` vouches for approvals and a snapshot
     *  that a hand-set status would skip, so the flow statuses are refused
     *  here, not just hidden in the UI (D-041). */
    status: z
      .enum(MANUAL_STATUSES, {
        error:
          'must be draft, applied, interviewing, offered or rejected — proposing, needs_review and ready are set by the review flow',
      })
      .optional(),
    /** `null` unlinks the resume. */
    resumeId: uuid.nullable().optional(),
    /** `null` unlinks the cover letter, which survives in the library. */
    coverLetterId: uuid.nullable().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

export const patchApplicationFileSchema = z.object({
  isArchived: z.boolean(),
});

/** One section of the review flow. Final approval is its own endpoint,
 *  because it compiles and snapshots where this only stamps (D-044). */
export const approveSectionSchema = z.object({
  section: z.enum(['resume', 'coverLetter'], { error: 'must be resume or coverLetter' }),
});

/** One answer, its mode, or a redraft request. Whether the answer fits the
 *  question's kind is the query layer's check, which knows the kind
 *  (`answerProblem`, D-047). */
export const patchApplicationQuestionSchema = z
  .object({
    /** A string, or a multi question's picks; null clears it. */
    answer: z
      .union([z.string(), z.array(z.string())], { error: 'must be a string or a list of strings' })
      .nullable()
      .optional(),
    answerMode: z.enum(ANSWER_MODES, { error: 'must be value or instruction' }).optional(),
    /** Null, or only whitespace, cancels the request. */
    redraftNote: z.string().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'no fields to update' });

/** The ids Chris saw, never "all of them" (D-047). */
export const approveQuestionsSchema = z.object({
  questionIds: z.array(uuid, { error: 'must be a list of question ids' }).min(1, 'is empty'),
});

// ---------------------------------------------------------------------------
// Bullet suggestions (D-045)
//
// The text rules are one schema, shared by `suggest_bullet` and the PATCH
// Chris's edits go through, so the agent and the page cannot disagree about
// what a suggestion may say.
// ---------------------------------------------------------------------------

/** One line of plain text, as the bullet should read. Resumix escapes it on
 *  its way into LaTeX, so a backslash can only mean the writer reached for
 *  LaTeX, which would print as a literal backslash. ASCII whitespace
 *  collapses as `escapeLatex` collapses it, so what is stored is what
 *  prints, and a non-breaking space typed on purpose survives. */
export const bulletSuggestionText = z
  .string()
  .transform((text) => text.replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ | $/g, ''))
  .pipe(
    z
      .string()
      .min(1, 'is required')
      .max(500, 'must be at most 500 characters')
      .refine((text) => !text.includes('\\'), {
        message: 'plain text: write it as it should read, without LaTeX',
      }),
  );

/** Why the agent suggests it, shown beside the card. */
export const bulletSuggestionRationale = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(300, 'must be at most 300 characters');

export const patchBulletSuggestionSchema = z.object({ proposedText: bulletSuggestionText });

/** Apply to bullet (Add bullet, on an addition), Save as new, Reject. */
export const resolveBulletSuggestionSchema = z.object({
  action: z.enum(['apply', 'copy', 'reject'], { error: 'must be apply, copy or reject' }),
});

// ---------------------------------------------------------------------------
// Feedback (in-app "Give feedback" widget → GitHub issue)
// ---------------------------------------------------------------------------

/** Only http(s): these URLs end up in markdown and in `href`s, so
 *  `javascript:` and friends have no business being there. */
const pageUrl = z.string().refine(isHttpUrl, { message: 'must be an http(s) URL' });

export const feedbackSchema = z.object({
  kind: z.enum(['bug', 'feature']),
  description: nonEmpty.max(10_000),
  url: pageUrl,
  viewport: z.string().max(40).optional(),
  userAgent: z.string().max(500).optional(),
  /** A multipart checkbox: `'true'` when on, absent when off. */
  planFirst: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
