/**
 * The streamable-HTTP transport, through real Web `Request`/`Response`
 * objects and no server. Which status a message gets is the part a client
 * library actually branches on.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { INVALID_REQUEST, LATEST_PROTOCOL_VERSION, PARSE_ERROR } from './dispatch.ts';
import { handleMcpPost, methodNotAllowed } from './http.ts';
import { defineTool, toolText } from './tool.ts';

const ctx = { userId: 'user-1' };
const tools = [
  defineTool({
    name: 'hello',
    description: 'Says hello.',
    input: z.strictObject({}),
    async run() {
      return toolText('hello');
    },
  }),
];

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return handleMcpPost(
    new Request('http://localhost/api/mcp', { method: 'POST', body, headers }),
    ctx,
    tools,
  );
}

const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

test('a body that is not JSON is 400 with -32700', async () => {
  const response = await post('{"jsonrpc": "2.0",');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, PARSE_ERROR);

  assert.equal((await post('')).status, 400);
});

test('a batch is 400 with -32600', async () => {
  const response = await post(`[${ping}, ${ping}]`);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, INVALID_REQUEST);
  assert.match(body.error.message, /one message per POST/);
});

test('an unsupported MCP-Protocol-Version is 400; a supported or absent one is not', async () => {
  const bad = await post(ping, { 'mcp-protocol-version': '2024-11-05' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, INVALID_REQUEST);

  assert.equal((await post(ping, { 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION })).status, 200);
  assert.equal((await post(ping)).status, 200);
});

test('a notification is 202 with an empty body', async () => {
  const response = await post(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  );
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
});

test('a request is 200 application/json, and no session id is ever issued', async () => {
  const response = await post(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'a',
      method: 'tools/call',
      params: { name: 'hello', arguments: {} },
    }),
    // Sent by a client that thinks it has a session: ignored.
    { 'mcp-session-id': 'abc' },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.equal(response.headers.get('mcp-session-id'), null);
  assert.deepEqual(await response.json(), {
    jsonrpc: '2.0',
    id: 'a',
    result: { content: [{ type: 'text', text: 'hello' }] },
  });
});

test('a malformed message is 400; a JSON-RPC method error is still 200', async () => {
  assert.equal((await post(JSON.stringify({ id: 1, method: 'ping' }))).status, 400);

  const unknown = await post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'nope' }));
  assert.equal(unknown.status, 200);
  assert.equal((await unknown.json()).error.code, -32601);
});

test('methodNotAllowed is 405, Allow: POST, with no body', async () => {
  const response = methodNotAllowed();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal(await response.text(), '');
});
