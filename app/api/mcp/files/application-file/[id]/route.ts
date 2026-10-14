import { type RouteContext, withApiErrors } from '@/lib/http';
import { serveApplyFile } from '@/lib/mcp/files';
import { requireMcpUserId } from '@/lib/session';

/**
 * An attachment in a Ready application's apply packet, for the agent to
 * upload: the approved letter's PDF, or a file a question picked (C5,
 * D-050). Same token as `/api/mcp`, checked first; `lib/mcp/files.ts`
 * decides whether this caller may have it.
 */
export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireMcpUserId(request);
    const { id } = await params;
    return serveApplyFile(userId, 'application-file', id);
  });
}
