/**
 * `create_application`: logs one job posting the agent has evaluated, in
 * `proposing` (C3), with its own copy of Default to propose a resume in.
 *
 * Not idempotent, by the ticket's choice: there is no server-side dedup, and
 * the description sends the agent to `list_applications` first instead.
 */
import { z } from 'zod';
import { createProposedApplication } from '../../queries/applications.ts';
import { isHttpUrl } from '../../validation.ts';
import { defineTool, toolJson } from '../tool.ts';

const text = z.string().trim().min(1, 'is required');

/** Tenths, tested with a tolerance: 0.7 * 10 is 7.000000000000001. */
function hasOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

export const createApplication = defineTool({
  name: 'create_application',
  description:
    'Creates a new application for one job posting, in status proposing, with its own copy ' +
    'of the Default resume named after the company. Not idempotent: call ' +
    'list_applications({ posting_url }) first and reuse its application_id if one exists. ' +
    'Returns JSON { application_id, status }. Next: get_library, then set_resume_selection.',
  input: z.strictObject({
    company: text,
    role_title: text,
    posting_url: z
      .string()
      .trim()
      .refine(isHttpUrl, { message: 'must be an http(s) URL' })
      .describe("The posting's own URL, as list_applications will be asked for it."),
    job_description: text.describe("The posting's text, as plain text."),
    agent_summary: text.describe('Your evaluation of the fit, as plain text with line breaks.'),
    // numeric(2,1) (C13). Rejected rather than rounded: rounding would
    // silently move the card in Needs review, which sorts by this (D-042).
    // A refine, not `.multipleOf(0.1)`, which `tools/list` would advertise as
    // `multipleOf: 0.1`: a client checking that in floating point finds
    // 4.3 % 0.1 ≈ 0.1 and refuses a valid score before it is ever sent.
    fit_score: z
      .number()
      .min(0, 'must be 0.0 to 5.0')
      .max(5, 'must be 0.0 to 5.0')
      .refine(hasOneDecimal, { message: 'must have at most one decimal place, e.g. 4.3' })
      .describe(
        'How well this posting fits, 0.0 to 5.0, with at most one decimal place (4.3, not 4.25).',
      ),
  }),
  async run(ctx, args) {
    const created = await createProposedApplication(ctx.userId, {
      company: args.company,
      roleTitle: args.role_title,
      postingUrl: args.posting_url,
      jobDescription: args.job_description,
      agentSummary: args.agent_summary,
      fitScore: args.fit_score,
    });
    return toolJson({ application_id: created.id, status: created.status });
  },
});
