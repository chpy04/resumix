/**
 * How every tool that takes an `application_id` (C1) turns it into a row,
 * and what it answers when it cannot. Shared so the lookup and the wording
 * stay one rule: missing, archived and another user's application all read
 * the same, and an archived application is as invisible to the agent as
 * archived content (D-042).
 */
import { getApplicationRow } from '../queries/applications.ts';
import { toolError, type ToolResult } from './tool.ts';

/** The caller's application, or null when it is missing, archived, or not
 *  theirs. */
export async function findLiveApplication(userId: string, id: string) {
  const row = await getApplicationRow(userId, id);
  return row && !row.isArchived ? row : null;
}

/** The answer for any application id `findLiveApplication` returned null for. */
export function noSuchApplication(id: string): ToolResult {
  return toolError(`No application ${id}. Call list_applications to find its application_id.`);
}
