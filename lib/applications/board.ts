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

/** Every status gets a column, including the empty ones: an empty
 *  "Interviewing" is information, and a column that appears and disappears as
 *  rows move is harder to aim at than one that is always there. */
export function groupByStatus(applications: readonly ApplicationSummary[]): BoardColumn[] {
  return APPLICATION_STATUSES.map((status) => ({
    status,
    applications: sortByRecency(applications.filter((a) => a.status === status)),
  }));
}
