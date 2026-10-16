/**
 * How every tool that changes one of Chris's own resumes, outside any
 * application, finds it (D-054), and what it answers when it cannot. Shared so
 * the rule stays one: a named resume, or with none named, Default, since "my
 * resume" is the one every new resume is copied from. A resume an
 * application uses is refused: it is tailored through that application's
 * own tools and review (D-045), never straight onto.
 */
import { z } from 'zod';
import {
  findApplicationUsingResume,
  getDefaultResumeRow,
  getResumeRow,
} from '../queries/resumes.ts';
import { toolError, type ToolResult } from './tool.ts';

type ResumeRow = NonNullable<Awaited<ReturnType<typeof getResumeRow>>>;

/** Where Chris opens a resume to see the agent's suggestions on it. */
export function editorPath(resumeId: string): string {
  return `/resume/${resumeId}`;
}

export async function findOwnResume(
  userId: string,
  resumeId: string | undefined,
): Promise<{ resume: ResumeRow } | { error: ToolResult }> {
  const resume =
    resumeId === undefined
      ? await getDefaultResumeRow(userId)
      : await getResumeRow(userId, resumeId);
  if (!resume) {
    return {
      error: toolError(
        resumeId === undefined
          ? 'There is no Default resume. Nothing was written; stop and tell Chris.'
          : `No resume ${resumeId}. Call list_resumes to find its resume_id.`,
      ),
    };
  }
  const usedBy = await findApplicationUsingResume(userId, resume.id);
  if (usedBy) {
    return {
      error: toolError(
        `Resume ${resume.id} is the one the ${usedBy.company} application (${usedBy.id}) is ` +
          'tailored on. Nothing was written; change it through that application, with ' +
          'set_resume_selection and suggest_bullet.',
      ),
    };
  }
  return { resume };
}

/** The argument every such tool takes: optional, and Default when absent. */
export const resumeIdField = z
  .uuid()
  .optional()
  .describe("One of Chris's own resumes, from list_resumes. Leave it out for Default.");
