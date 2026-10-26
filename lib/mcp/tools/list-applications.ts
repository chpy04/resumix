/**
 * `list_applications`: finds applications, chiefly so the agent can tell
 * whether a posting is already logged before `create_application` logs it
 * again. Archived applications are absent, as archived content is from
 * `get_library` (D-042).
 */
import { z } from 'zod';
import { APPLICATION_STATUSES } from '../../applications/status.ts';
import { listApplications as listAll } from '../../queries/applications.ts';
import { defineTool, toolJson } from '../tool.ts';

export const listApplications = defineTool({
  name: 'list_applications',
  description:
    'Lists applications, newest first, as JSON: [{ application_id, company, role_title, ' +
    'posting_url, status, fit_score, created_at }], or [] when none match. Call it with ' +
    'posting_url before create_application, which always makes a new one; reuse the ' +
    'application_id if one comes back. Filter by status to find work in a given stage.',
  input: z.strictObject({
    status: z.enum(APPLICATION_STATUSES).optional(),
    posting_url: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Matched exactly, after trimming; no other normalisation.'),
  }),
  async run(ctx, args) {
    const all = await listAll(ctx.userId, false);
    const matches = all.filter(
      (a) =>
        (args.posting_url === undefined || a.postingUrl.trim() === args.posting_url) &&
        (args.status === undefined || a.status === args.status),
    );
    return toolJson(
      matches.map((a) => ({
        application_id: a.id,
        company: a.company,
        role_title: a.roleTitle,
        posting_url: a.postingUrl,
        status: a.status,
        fit_score: a.fitScore,
        created_at: a.createdAt,
      })),
    );
  },
});
