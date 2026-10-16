import { type RouteContext, withApiErrors } from '@/lib/http';
import { serveApplyFile } from '@/lib/mcp/files';
import { requireMcpUserId } from '@/lib/session';

/**
 * A Ready application's pinned resume PDF, for the agent to upload (C5,
 * D-050). Same token as `/api/mcp`, checked first; `lib/mcp/files.ts`
 * decides whether this caller may have it. One route per kind, because a
 * route's `params` hold only `{ id }` (`RouteContext`).
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireMcpUserId(request);
    const { id } = await params;
    return serveApplyFile(userId, 'resume-pdf', id);
  });
}
