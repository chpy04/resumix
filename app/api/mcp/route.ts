import { withApiErrors } from '@/lib/http';
import { handleMcpPost, methodNotAllowed } from '@/lib/mcp/http';
import { TOOLS } from '@/lib/mcp/tools/index';
import { requireMcpUserId } from '@/lib/session';

/**
 * The agent's endpoint: MCP over streamable HTTP, stateless (D-040). The
 * protocol lives in `lib/mcp/`; this file only authenticates and hands over.
 *
 * The token is checked before the body is read, and a bad one is the plain
 * `401 { error }` every other route gives, not a JSON-RPC error: MCP leaves
 * auth to the HTTP layer (D-039).
 */
export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const userId = await requireMcpUserId(request);
    return handleMcpPost(request, { userId }, TOOLS);
  });
}

/** No SSE stream to open. Authenticated anyway, so every handler under
 *  `/api/mcp/**` starts with the token check and none is an exception. */
export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    await requireMcpUserId(request);
    return methodNotAllowed();
  });
}
