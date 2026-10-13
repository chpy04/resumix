/**
 * `get_application`: one application as the agent needs it to carry on:
 * where it is in the flow, what the posting said, what it concluded, which
 * resume content is selected, and what has been approved.
 */
import { z } from 'zod';
import { getResumeRow } from '../../queries/resumes.ts';
import { getSelections } from '../../queries/selections.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { fromSelections } from '../selection.ts';
import { defineTool, toolJson } from '../tool.ts';

export const getApplication = defineTool({
  name: 'get_application',
  description:
    'Returns one application as JSON: { application_id, company, role_title, posting_url, ' +
    'status, fit_score, job_description, agent_summary, selection, approval: ' +
    '{ resume_approved_at, cover_letter_approved_at, approved_at } }. selection is what its ' +
    'resume shows now, in the shape set_resume_selection takes, or null when it has no resume. ' +
    'Call it to pick up an application where you left off.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    const row = await findLiveApplication(ctx.userId, args.application_id);
    if (!row) return noSuchApplication(args.application_id);

    const resume = row.resumeId ? await getResumeRow(ctx.userId, row.resumeId) : null;
    const selection = resume ? fromSelections(await getSelections(resume.id)) : null;

    return toolJson({
      application_id: row.id,
      company: row.company,
      role_title: row.roleTitle,
      posting_url: row.postingUrl,
      status: row.status,
      fit_score: row.fitScore,
      job_description: row.jobDescription,
      agent_summary: row.agentSummary,
      selection,
      approval: {
        resume_approved_at: row.resumeApprovedAt?.toISOString() ?? null,
        cover_letter_approved_at: row.coverLetterApprovedAt?.toISOString() ?? null,
        approved_at: row.approvedAt?.toISOString() ?? null,
      },
    });
  },
});
