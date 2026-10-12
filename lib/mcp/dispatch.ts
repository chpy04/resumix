/**
 * MCP's JSON-RPC 2.0 layer: one decoded message in, one response (or none)
 * out. No HTTP and no database, so every protocol rule is a unit test
 * (`dispatch.test.ts`). `http.ts` puts it on the wire.
 *
 * Stateless (D-040). Nothing is remembered between messages, so
 * `tools/list` works without an `initialize` first, and there is no session
 * to lose when the server restarts.
 */
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../queries/errors.ts';
import {
  describeIssue,
  toolError,
  type McpContext,
  type McpTool,
  type ToolResult,
} from './tool.ts';

/**
 * Newest first; the first entry is what a client asking for anything else
 * gets. The list stops at 2025-03-26, the revision that introduced the
 * streamable-HTTP transport this endpoint speaks.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;

type JsonRpcId = string | number;

interface JsonRpcError {
  code: number;
  message: string;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId; result: unknown }
  | { jsonrpc: '2.0'; id: JsonRpcId | null; error: JsonRpcError };

export const SERVER_INFO = { name: 'resumix', version: '0.1.0' } as const;

/** Read by the model once, at connect time: what Resumix is, and the two
 *  conventions every tool follows (C1). */
const SERVER_INSTRUCTIONS =
  "Resumix holds one person's resume library (experiences, projects, bullets, skills), " +
  'their resumes and cover letters, and the job applications built from them. ' +
  'Tools that act on one application take its application_id, and Resumix finds ' +
  "that application's resume and cover letter itself. Resumix also owns all the LaTeX: " +
  'escaping, splicing and compiling, so work in plain text. ' +
  'When a tool result has isError set, its text says what to do next; do that rather ' +
  'than working around the tool. Call ping first to check the connection.';

/** Shown for anything a tool throws that is not a query-layer error. The
 *  real error goes to the server log, never to the agent. */
export const INTERNAL_TOOL_ERROR =
  'Resumix hit an internal error; retry once, then stop and tell Chris.';

const toolsCallParams = z.looseObject({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export function rpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON-RPC allows a null id; MCP does not. */
function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

/** The client's version if we speak it, otherwise our latest, which the
 *  client then accepts or disconnects over. */
function negotiateProtocolVersion(requested: string): string {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION;
}

function initialize(id: JsonRpcId, params: unknown): JsonRpcResponse {
  const requested = isRecord(params) ? params.protocolVersion : undefined;
  if (typeof requested !== 'string') {
    return rpcError(id, INVALID_PARAMS, 'initialize needs params.protocolVersion (a string)');
  }
  return rpcResult(id, {
    protocolVersion: negotiateProtocolVersion(requested),
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  });
}

/**
 * Runs one tool, turning anything it throws into a result (C1). The mapping
 * copies `withApiErrors`: query-layer errors carry a message written for the
 * caller, so it passes through; anything else is a bug, logged and hidden.
 */
async function callTool(tool: McpTool, ctx: McpContext, args: unknown): Promise<ToolResult> {
  try {
    return await tool.call(ctx, args);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof BadRequestError) {
      return toolError(err.message);
    }
    console.error(err);
    return toolError(INTERNAL_TOOL_ERROR);
  }
}

async function toolsCall(
  id: JsonRpcId,
  params: unknown,
  ctx: McpContext,
  tools: readonly McpTool[],
): Promise<JsonRpcResponse> {
  const parsed = toolsCallParams.safeParse(params);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(describeIssue).join('; ');
    return rpcError(id, INVALID_PARAMS, `Invalid params: ${issues}`);
  }

  const tool = tools.find((t) => t.name === parsed.data.name);
  if (!tool) return rpcError(id, INVALID_PARAMS, `Unknown tool: ${parsed.data.name}`);

  // `arguments` is optional on the wire; a tool with no inputs gets `{}`.
  return rpcResult(id, await callTool(tool, ctx, parsed.data.arguments ?? {}));
}

/**
 * One JSON-RPC message, already decoded. Returns null for anything that gets
 * no response: a notification (`notifications/initialized` included) or a
 * response from the client, neither of which this server asks for or acts on.
 */
export async function handleMessage(
  message: unknown,
  ctx: McpContext,
  tools: readonly McpTool[],
): Promise<JsonRpcResponse | null> {
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return rpcError(null, INVALID_REQUEST, 'Invalid Request: expected a JSON-RPC 2.0 object');
  }
  if ('id' in message && !isId(message.id)) {
    return rpcError(null, INVALID_REQUEST, 'Invalid Request: id must be a string or a number');
  }
  const id = isId(message.id) ? message.id : null;

  if (!('method' in message)) {
    if ('result' in message || 'error' in message) return null;
    return rpcError(id, INVALID_REQUEST, 'Invalid Request: no method');
  }
  if (typeof message.method !== 'string') {
    return rpcError(id, INVALID_REQUEST, 'Invalid Request: method must be a string');
  }
  if (id === null) return null;

  switch (message.method) {
    case 'initialize':
      return initialize(id, message.params);
    case 'ping':
      // The JSON-RPC liveness check, which every MCP peer answers. Not the
      // `ping` tool, which lives in `tools/call`'s namespace.
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case 'tools/call':
      return toolsCall(id, message.params, ctx, tools);
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}
