/**
 * Turning a flat list of applications into the board: one group per status,
 * in a fixed order, each sorted by how recently something happened to it.
 *
 * Pure so it can be tested without a browser or a database — the board
 * component only renders what this returns.
 */
import { APPLICATION_STATUSES } from './status.ts';
import type { ApplicationStatus, ApplicationSummary } from '../types.ts';

export interface BoardColumn {
  status: ApplicationStatus;
  applications: ApplicationSummary[];
}

/**
 * The kanban's columns: the statuses that still want something from you.
 *
 * `applied` and `rejected` are deliberately absent. Both are where an
 * application goes to be forgotten — one waiting, one over — and as columns
 * they would grow without bound and bury the handful that are live. They are
 * drop targets below the board instead, and the rows land in a table (D-033).
 */
export const KANBAN_STATUSES = [
  'draft',
  'interviewing',
  'offered',
] as const satisfies readonly ApplicationStatus[];

/** The two ways off the board, offered as drop zones under the columns while
 *  a card is being dragged. */
export const EXIT_STATUSES = [
  'applied',
  'rejected',
] as const satisfies readonly ApplicationStatus[];

/**
 * "Most recent first", where recency means the day it was sent, falling back
 * to the day it was created for a draft that never was. The id breaks ties,
 * so two applications logged in the same second never swap places between
 * renders (the same rule the data layer follows — D-030).
 */
function recencyKey(application: ApplicationSummary): string {
  return application.appliedAt ?? application.createdAt;
}

export function sortByRecency(applications: readonly ApplicationSummary[]): ApplicationSummary[] {
  return [...applications].sort((a, b) => {
    const byRecency = recencyKey(b).localeCompare(recencyKey(a));
    if (byRecency !== 0) return byRecency;
    return b.id.localeCompare(a.id);
  });
}

/** Every kanban status gets a column, including the empty ones: an empty
 *  "Interviewing" is information, and a column that appears and disappears as
 *  rows move is harder to aim at than one that is always there. */
export function groupByStatus(applications: readonly ApplicationSummary[]): BoardColumn[] {
  return KANBAN_STATUSES.map((status) => ({
    status,
    applications: sortByRecency(applications.filter((a) => a.status === status)),
  }));
}

/** The other half of the board: everything that has left the kanban, most
 *  recent first. Rendered as a table rather than cards because the useful
 *  thing to do with this pile is search it. */
export function closedApplications(
  applications: readonly ApplicationSummary[],
): ApplicationSummary[] {
  const exited = new Set<string>(EXIT_STATUSES);
  return sortByRecency(applications.filter((a) => exited.has(a.status)));
}

/**
 * What a drop should change the dragged card's status to, or `null` when it
 * should change nothing — dropped back where it started, or on something
 * that is not a status at all.
 *
 * Pure because the drag itself is the untestable part: given the two ids, the
 * decision is ordinary logic and belongs where it can be checked.
 */
export function statusForDrop(
  current: ApplicationStatus,
  dropTargetId: string,
): ApplicationStatus | null {
  const target = APPLICATION_STATUSES.find((status) => status === dropTargetId);
  if (!target || target === current) return null;
  return target;
}
