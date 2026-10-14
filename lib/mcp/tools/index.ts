/**
 * Every tool `/api/mcp` serves, in `tools/list` order. A new tool is one
 * module here, one entry below, one row in docs/API.md's tool reference, and
 * a test (.claude/rules/mcp.md).
 */
import type { McpTool } from '../tool.ts';
import { createApplication } from './create-application.ts';
import { getApplication } from './get-application.ts';
import { getLibrary } from './get-library.ts';
import { listApplications } from './list-applications.ts';
import { ping } from './ping.ts';
import { setCoverLetterBody } from './set-cover-letter-body.ts';
import { setResumeSelection } from './set-resume-selection.ts';
import { submitForReview } from './submit-for-review.ts';
import { suggestBullet } from './suggest-bullet.ts';

export const TOOLS: readonly McpTool[] = [
  ping,
  getLibrary,
  listApplications,
  getApplication,
  createApplication,
  setResumeSelection,
  suggestBullet,
  setCoverLetterBody,
  submitForReview,
];
