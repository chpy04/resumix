/**
 * Every tool `/api/mcp` serves, in `tools/list` order. A new tool is one
 * module here, one entry below, one row in docs/API.md's tool reference, and
 * a test (.claude/rules/mcp.md).
 */
import type { McpTool } from '../tool.ts';
import { addQuestions } from './add-questions.ts';
import { createApplication } from './create-application.ts';
import { editResumeSelection } from './edit-resume-selection.ts';
import { getApplication } from './get-application.ts';
import { getApplyPacket } from './get-apply-packet.ts';
import { getLibrary } from './get-library.ts';
import { getResume } from './get-resume.ts';
import { getSavedAnswers } from './get-saved-answers.ts';
import { listApplications } from './list-applications.ts';
import { listResumes } from './list-resumes.ts';
import { markApplied } from './mark-applied.ts';
import { ping } from './ping.ts';
import { reportQuestion } from './report-question.ts';
import { setCoverLetterBody } from './set-cover-letter-body.ts';
import { setResumeSelection } from './set-resume-selection.ts';
import { submitForReview } from './submit-for-review.ts';
import { suggestBullet } from './suggest-bullet.ts';
import { suggestResumeBullet } from './suggest-resume-bullet.ts';

export const TOOLS: readonly McpTool[] = [
  ping,
  getLibrary,
  getSavedAnswers,
  listResumes,
  getResume,
  editResumeSelection,
  suggestResumeBullet,
  listApplications,
  getApplication,
  getApplyPacket,
  createApplication,
  addQuestions,
  setResumeSelection,
  suggestBullet,
  setCoverLetterBody,
  submitForReview,
  reportQuestion,
  markApplied,
];
