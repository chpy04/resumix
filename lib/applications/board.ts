/**
 * Turning a flat list of applications into the board: one group per status,
 * in a fixed order, each sorted by how recently something happened to it —
 * except Needs review, which is sorted by how good a fit it is.
 *
 * Pure so it can be tested without a browser or a database — the board
 * component only renders what this returns.
 */
import { FLOW_STATUSES, MANUAL_STATUSES, type ManualStatus } from './status.ts';
import type { ApplicationStatus, ApplicationSummary } from '../types.ts';

export interface BoardColumn {
  status: ApplicationStatus;
  applications: ApplicationSummary[];
}

/**
 * The kanban's columns: the statuses that still want something from you, in
 * the order an application moves through them.
 *
 * `applied` and `rejected` are deliberately absent. Both are where an
 * application goes to be forgotten — one waiting, one over — and as columns
 * they would grow without bound and bury the handful that are live. They are
 * drop targets below the board instead, and the rows land in a table (D-034).
 */
export const KANBAN_STATUSES = [
  'draft',
  'proposing',
  'needs_review',
  'ready',
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

function byRecency(a: ApplicationSummary, b: ApplicationSummary): number {
  const recency = recencyKey(b).localeCompare(recencyKey(a));
  if (recency !== 0) return recency;
  return b.id.localeCompare(a.id);
}

export function sortByRecency(applications: readonly ApplicationSummary[]): ApplicationSummary[] {
  return [...applications].sort(byRecency);
}

/**
 * Best fit first, for the column you work through top to bottom (R15).
 * Unscored applications go last rather than reading as a zero — "the agent
 * gave no score" is not "the agent scored it 0.0" — and ties fall back to
 * recency, then id, so the order is still total (D-030).
 */
export function sortByFit(applications: readonly ApplicationSummary[]): ApplicationSummary[] {
  return [...applications].sort((a, b) => {
    if (a.fitScore !== b.fitScore) {
      if (a.fitScore === null) return 1;
      if (b.fitScore === null) return -1;
      return b.fitScore - a.fitScore;
    }
    return byRecency(a, b);
  });
}

/** Every kanban status gets a column, including the empty ones: an empty
 *  "Interviewing" is information, and a column that appears and disappears as
 *  rows move is harder to aim at than one that is always there. */
export function groupByStatus(applications: readonly ApplicationSummary[]): BoardColumn[] {
  return KANBAN_STATUSES.map((status) => {
    const inColumn = applications.filter((a) => a.status === status);
    return {
      status,
      applications: status === 'needs_review' ? sortByFit(inColumn) : sortByRecency(inColumn),
    };
  });
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

/** Whether a column takes drops at all. The flow columns do not: only the
 *  review flow moves an application into them (C3). */
export function acceptsDrop(status: ApplicationStatus): boolean {
  return !(FLOW_STATUSES as readonly ApplicationStatus[]).includes(status);
}

/**
 * What a drop should change the dragged card's status to, or `null` when it
 * should change nothing — dropped back where it started, on a flow column, or
 * on something that is not a status at all.
 *
 * Only manual statuses are ever returned, so a drop can never do what the API
 * would refuse. A card *in* a flow column can still go anywhere manual.
 *
 * Pure because the drag itself is the untestable part: given the two ids, the
 * decision is ordinary logic and belongs where it can be checked.
 */
export function statusForDrop(
  current: ApplicationStatus,
  dropTargetId: string,
): ManualStatus | null {
  const target = MANUAL_STATUSES.find((status) => status === dropTargetId);
  if (!target || target === current) return null;
  return target;
}
