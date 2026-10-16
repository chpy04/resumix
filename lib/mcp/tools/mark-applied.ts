/**
 * `mark_applied`: Chris has submitted a Ready application's form himself,
 * so it moves to Applied, keeping the resume PDF he approved (C3, C4,
 * D-050). The agent calls it only after he says so; it never submits
 * anything.
 *
 * Only from `ready`. The status is re-checked in the UPDATE
 * (`recordReadyApplied`), so an edit that reopened the application while
 * the form was being filled wins, and the agent is told to leave the rest
 * to Chris rather than retry.
 */
import { z } from 'zod';
import { hasBeenSent } from '../../applications/status.ts';
import { recordReadyApplied } from '../../queries/applications.ts';
import type { ApplicationStatus } from '../../types.ts';
import { findLiveApplication, noSuchApplication } from '../application.ts';
import { defineTool, toolError, toolJson, type ToolResult } from '../tool.ts';

function refusal(status: ApplicationStatus): ToolResult {
  if (hasBeenSent(status))
    return toolError(`This application is already ${status}; nothing to do.`);
  return toolError(
    `This application is ${status}, not Ready: it changed after the packet was fetched. ` +
      'Nothing was changed. If Chris already submitted, ask him to mark it applied on its page ' +
      'in Resumix.',
  );
}

export const markApplied = defineTool({
  name: 'mark_applied',
  description:
    'Records that Chris submitted an application: moves it from ready to applied and stamps ' +
    'applied_at, keeping the resume PDF he approved. Call it only after Chris has told you he ' +
    'clicked Submit himself; never before, and never because the form looks finished. Refused ' +
    'unless the application is ready. Returns JSON { application_id, status: "applied", ' +
    'applied_at, resume_filename }.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    const app = await findLiveApplication(ctx.userId, args.application_id);
    if (!app) return noSuchApplication(args.application_id);
    if (app.status !== 'ready') return refusal(app.status);

    const sent = await recordReadyApplied(ctx.userId, app.id);
    if (!sent) {
      // Moved between the read and the guarded write: say where it is now.
      const now = await findLiveApplication(ctx.userId, app.id);
      return now ? refusal(now.status) : noSuchApplication(app.id);
    }

    return toolJson({
      application_id: sent.id,
      status: 'applied',
      applied_at: sent.appliedAt,
      resume_filename: sent.sentPdf?.filename ?? null,
    });
  },
});
