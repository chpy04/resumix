/**
 * `get_application`: one application as the agent needs it to carry on:
 * where it is in the flow, what the posting said, what it concluded, which
 * resume content is selected, what has been approved, and the form's
 * questions, a redraft request among them (D-047).
 */
import { z } from 'zod';
import { listQuestions } from '../../queries/application-questions.ts';
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
    '{ resume_approved_at, cover_letter_approved_at, approved_at }, questions: [{ ' +
    'question_id, prompt, kind, options, field_ref, required, is_eeo, source, answer_mode, ' +
    'proposed_answer, answer, approved_at, redraft_note }] }. selection is what its resume ' +
    'shows now, in the shape set_resume_selection takes, or null when it has no resume. ' +
    'questions are the ones add_questions recorded, in order; answer is what Chris has ' +
    'approved or edited. A question with a redraft_note is Chris asking you for a new draft, ' +
    'and the note says what to change: send it again with add_questions. Call it to pick up ' +
    'an application where you left off.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    const row = await findLiveApplication(ctx.userId, args.application_id);
    if (!row) return noSuchApplication(args.application_id);

    const resume = row.resumeId ? await getResumeRow(ctx.userId, row.resumeId) : null;
    const selection = resume ? fromSelections(await getSelections(resume.id)) : null;
    const questions = await listQuestions(ctx.userId, row.id);

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
      questions: questions.map((q) => ({
        question_id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        options: q.options,
        field_ref: q.fieldRef,
        required: q.required,
        is_eeo: q.isEeo,
        source: q.source,
        answer_mode: q.answerMode,
        proposed_answer: q.proposedAnswer,
        answer: q.answer,
        approved_at: q.approvedAt,
        redraft_note: q.redraftNote,
      })),
    });
  },
});
