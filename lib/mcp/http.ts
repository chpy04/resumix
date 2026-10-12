/**
 * MCP's streamable-HTTP transport, reduced to what a stateless server needs
 * (D-040): one JSON-RPC message per POST, answered with one
 * `application/json` body or a bare 202.
 *
 * What is deliberately absent: no `Mcp-Session-Id` is ever issued, and one
 * sent by a client is ignored, because there is no state to key; no SSE,
 * because nothing here streams; no batches, which 2025-06-18 removed and no
 * client we serve sends. `Accept` and `Content-Type` are not enforced: the
 * answer is JSON whatever the client asked for, and curl should just work.
 *
 * Plain Web `Request`/`Response`, so it runs under `node --test` without
 * Next. Authentication happens before this, in the route
 * (`requireMcpUserId`).
 */
import {
  handleMessage,
  INVALID_REQUEST,
  PARSE_ERROR,
  rpcError,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './dispatch.ts';
import type { McpContext, McpTool } from './tool.ts';

/** JSON-RPC errors that mean the HTTP request itself was bad. */
const BAD_REQUEST_CODES: readonly number[] = [PARSE_ERROR, INVALID_REQUEST];

export async function handleMcpPost(
  request: Request,
  ctx: McpContext,
  tools: readonly McpTool[],
): Promise<Response> {
  let message: unknown;
  try {
    message = JSON.parse(await request.text());
  } catch {
    return Response.json(rpcError(null, PARSE_ERROR, 'Parse error: the body is not JSON'), {
      status: 400,
    });
  }

  if (Array.isArray(message)) {
    return Response.json(
      rpcError(
        null,
        INVALID_REQUEST,
        'Invalid Request: batches are not supported; send one message per POST',
      ),
      { status: 400 },
    );
  }

  // Absent is fine: `initialize` precedes any agreed version, and the spec
  // has a server assume one when the header is missing.
  const version = request.headers.get('mcp-protocol-version');
  if (version !== null && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return Response.json(
      rpcError(
        null,
        INVALID_REQUEST,
        `Unsupported MCP-Protocol-Version: ${version}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
      ),
      { status: 400 },
    );
  }

  const response = await handleMessage(message, ctx, tools);
  if (response === null) return new Response(null, { status: 202 });

  const status = 'error' in response && BAD_REQUEST_CODES.includes(response.error.code) ? 400 : 200;
  return Response.json(response, { status });
}

/** `GET` would open a server-to-client SSE stream. A stateless server has
 *  nothing to push, and the spec's answer for that is 405. */
export function methodNotAllowed(): Response {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
