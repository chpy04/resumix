/**
 * The JSON-RPC layer, against fake tools: no HTTP, no database. What the
 * agent sees when it gets something wrong matters as much as the happy
 * path, because that text is all it has to correct itself with (C1).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { BadRequestError, NotFoundError } from '../queries/errors.ts';
import {
  handleMessage,
  INTERNAL_TOOL_ERROR,
  INVALID_PARAMS,
  INVALID_REQUEST,
  LATEST_PROTOCOL_VERSION,
  METHOD_NOT_FOUND,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcResponse,
} from './dispatch.ts';
import { defineTool, toolError, toolText, type McpTool } from './tool.ts';

const ctx = { userId: 'user-1' };

const echo = defineTool({
  name: 'echo',
  description: 'Echoes its argument, and who asked.',
  input: z.strictObject({ application_id: z.uuid(), note: z.string().optional() }),
  async run(c, args) {
    return toolText(`${c.userId}:${args.application_id}:${args.note ?? ''}`);
  },
});

const refuses = defineTool({
  name: 'refuses',
  description: 'Always says no, the way a tool should.',
  input: z.strictObject({}),
  async run() {
    return toolError('No. Call echo instead.');
  },
});

function throwing(name: string, err: unknown): McpTool {
  return defineTool({
    name,
    description: `Throws ${name}.`,
    input: z.strictObject({}),
    async run() {
      throw err;
    },
  });
}

const tools: readonly McpTool[] = [
  echo,
  refuses,
  throwing('not_found', new NotFoundError('application 42 not found')),
  throwing('bad_request', new BadRequestError('unknown experience id')),
  throwing('crashes', new Error('connection string postgres://secret@db')),
];

const APP_ID = '6f1c1f0e-3b0a-4c9e-9d55-0a4c6f7d2e11';

function request(method: string, params?: unknown, id: string | number = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function send(message: unknown): Promise<JsonRpcResponse> {
  const response = await handleMessage(message, ctx, tools);
  assert.ok(response, 'expected a response, got none');
  return response;
}

async function result(message: unknown): Promise<Record<string, unknown>> {
  const response = await send(message);
  assert.ok('result' in response, `expected a result, got ${JSON.stringify(response)}`);
  return response.result as Record<string, unknown>;
}

async function errorCode(message: unknown): Promise<{ code: number; message: string }> {
  const response = await send(message);
  assert.ok('error' in response, `expected an error, got ${JSON.stringify(response)}`);
  return response.error;
}

async function callResult(name: string, args?: unknown) {
  const params = args === undefined ? { name } : { name, arguments: args };
  return (await result(request('tools/call', params))) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

// --- initialize -------------------------------------------------------------

test('initialize echoes every supported protocol version', async () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    const r = await result(request('initialize', { protocolVersion: version }));
    assert.equal(r.protocolVersion, version);
  }
});

test('initialize answers an unknown version with the latest', async () => {
  const r = await result(request('initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(r.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(LATEST_PROTOCOL_VERSION, '2025-11-25');
});

test('initialize without a string protocolVersion is -32602', async () => {
  assert.equal((await errorCode(request('initialize', {}))).code, INVALID_PARAMS);
  assert.equal((await errorCode(request('initialize'))).code, INVALID_PARAMS);
  assert.equal(
    (await errorCode(request('initialize', { protocolVersion: 20251125 }))).code,
    INVALID_PARAMS,
  );
});

test('initialize advertises tools, names the server and carries instructions', async () => {
  const r = await result(
    request('initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    }),
  );
  assert.deepEqual(r.capabilities, { tools: { listChanged: false } });
  assert.deepEqual(r.serverInfo, SERVER_INFO);
  assert.equal(typeof r.instructions, 'string');
  assert.match(r.instructions as string, /application_id/);
  assert.match(r.instructions as string, /isError/);
});

// --- ping, tools/list, unknown methods ---------------------------------------

test('the ping method returns an empty result', async () => {
  assert.deepEqual(await result(request('ping')), {});
});

test('a response keeps the request id, string or number', async () => {
  assert.equal((await send(request('ping', undefined, 'abc'))).id, 'abc');
  assert.equal((await send(request('ping', undefined, 7))).id, 7);
});

test('tools/list returns every tool with its name, description and schema', async () => {
  const r = (await result(request('tools/list'))) as {
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  };
  assert.deepEqual(
    r.tools.map((t) => t.name),
    tools.map((t) => t.name),
  );
  const listed = r.tools[0];
  assert.ok(listed);
  assert.deepEqual(Object.keys(listed).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(listed.description, echo.description);
  assert.equal(listed.inputSchema.type, 'object');
  assert.deepEqual(listed.inputSchema.required, ['application_id']);
  assert.equal(listed.inputSchema.additionalProperties, false);
});

test('an unknown method is -32601', async () => {
  const error = await errorCode(request('resources/list'));
  assert.equal(error.code, METHOD_NOT_FOUND);
  assert.match(error.message, /resources\/list/);
});

// --- tools/call ---------------------------------------------------------------

test('tools/call runs the tool with the caller and the parsed arguments', async () => {
  const r = await callResult('echo', { application_id: APP_ID, note: 'hi' });
  assert.deepEqual(r, { content: [{ type: 'text', text: `user-1:${APP_ID}:hi` }] });
});

test('tools/call without arguments passes the tool an empty object', async () => {
  // Reaching the tool's own refusal means `{}` passed its strictObject; an
  // undefined would have failed validation first.
  const r = await callResult('refuses');
  assert.equal(r.content[0]?.text, 'No. Call echo instead.');
});

test('an unknown tool is -32602 naming it', async () => {
  const error = await errorCode(request('tools/call', { name: 'nope' }));
  assert.equal(error.code, INVALID_PARAMS);
  assert.equal(error.message, 'Unknown tool: nope');
});

test('a malformed tools/call envelope is -32602', async () => {
  for (const params of [{ name: 'echo', arguments: [APP_ID] }, { arguments: {} }, undefined]) {
    assert.equal((await errorCode(request('tools/call', params))).code, INVALID_PARAMS);
  }
});

test('bad arguments are an isError result naming each field, not a JSON-RPC error', async () => {
  const r = await callResult('echo', { applicationId: APP_ID, note: 3 });
  assert.equal(r.isError, true);
  const text = r.content[0]?.text ?? '';
  assert.match(text, /application_id: /);
  assert.match(text, /note: /);
  assert.match(text, /applicationId/); // strictObject rejects the typo by name
  assert.match(text, /tools\/list has the schema/);
});

test('a tool’s own toolError passes through untouched', async () => {
  const r = await callResult('refuses', {});
  assert.deepEqual(r, {
    content: [{ type: 'text', text: 'No. Call echo instead.' }],
    isError: true,
  });
});

test('a thrown NotFoundError or BadRequestError becomes isError with its message', async () => {
  const notFound = await callResult('not_found', {});
  assert.equal(notFound.isError, true);
  assert.equal(notFound.content[0]?.text, 'application 42 not found');

  const badRequest = await callResult('bad_request', {});
  assert.equal(badRequest.isError, true);
  assert.equal(badRequest.content[0]?.text, 'unknown experience id');
});

test('any other throw is a generic isError that leaks nothing', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const r = await callResult('crashes', {});
  assert.equal(r.isError, true);
  assert.equal(r.content[0]?.text, INTERNAL_TOOL_ERROR);
  assert.doesNotMatch(JSON.stringify(r), /postgres|secret/);
  assert.equal(logged.mock.callCount(), 1, 'the real error goes to the server log');
});

// --- messages that get no response, and malformed ones -----------------------

test('a notification gets no response, known or not', async () => {
  for (const method of ['notifications/initialized', 'notifications/whatever', 'tools/list']) {
    assert.equal(await handleMessage({ jsonrpc: '2.0', method }, ctx, tools), null);
  }
});

test('a response from the client gets no response', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', id: 1, result: {} }, ctx, tools), null);
  assert.equal(
    await handleMessage({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } }, ctx, tools),
    null,
  );
});

test('a malformed message is -32600 with a null id', async () => {
  const malformed: unknown[] = [
    { jsonrpc: '2.0', id: null, method: 'ping' }, // MCP forbids a null id
    { id: 1, method: 'ping' }, // no jsonrpc
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: { n: 1 }, method: 'ping' },
    'ping',
    null,
    42,
  ];
  for (const message of malformed) {
    const response = await send(message);
    assert.ok('error' in response, JSON.stringify(message));
    assert.equal(response.error.code, INVALID_REQUEST);
    assert.equal(response.id, null);
  }
});

test('a request with a non-string method or no method is -32600', async () => {
  assert.equal((await errorCode({ jsonrpc: '2.0', id: 1, method: 5 })).code, INVALID_REQUEST);
  assert.equal((await errorCode({ jsonrpc: '2.0', id: 1 })).code, INVALID_REQUEST);
});
