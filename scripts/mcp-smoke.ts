/**
 * Drives `/api/mcp` over real HTTP the way an MCP client does: requests
 * with no token or a foreign one, `initialize`, `notifications/initialized`,
 * `tools/list`, the `ping` tool, and a `GET` (D-040). The unit tests prove the protocol without a server;
 * this proves the route, the token check and the database behind it.
 *
 * It needs a running server. `npm run verify` runs it from
 * `e2e/mcp.spec.ts`, against Playwright's own server; by hand, start
 * `npm run dev` and run `npm run mcp:smoke`.
 *
 * The token is minted here, for the first user (the seeded one, as in dev
 * mode), and revoked when the script ends, pass or fail. A token minted in
 * advance would not survive: `verify` reseeds, which wipes them.
 *
 * Development only (C8, C14). It reads `MCP_SMOKE_URL`, never
 * `RESUMIX_MCP_URL`, which is the agent workspace's name for production,
 * and it refuses a non-loopback host, production's web port and production's
 * database port.
 *
 * Usage:
 *   npm run mcp:smoke
 *   MCP_SMOKE_URL=http://localhost:3100/api/mcp npm run mcp:smoke
 */
import assert from 'node:assert/strict';

import { sql } from '../lib/db/index.ts';
import { createApiToken, revokeApiToken } from '../lib/queries/api-tokens.ts';
import { getFirstUser } from '../lib/queries/users.ts';

const DEFAULT_URL = 'http://localhost:3000/api/mcp';
// What a current client sends, written out rather than imported, so this
// checks the server from the client's side.
const PROTOCOL_VERSION = '2025-11-25';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROD_WEB_PORT = '39000';
const PROD_DB_PORT = '39432';

/** The endpoint to hit, or null after saying on stderr why not. */
function target(): URL | null {
  const raw = process.env.MCP_SMOKE_URL ?? DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error(`mcp:smoke: MCP_SMOKE_URL is not a URL: ${raw}`);
    return null;
  }
  if (!LOOPBACK.has(url.hostname)) {
    console.error(`mcp:smoke: refusing ${url.host}; this runs against a local dev server only.`);
    return null;
  }
  if (url.port === PROD_WEB_PORT) {
    console.error(`mcp:smoke: refusing port ${PROD_WEB_PORT}, which is production.`);
    return null;
  }

  const db = process.env.DATABASE_URL;
  if (db && URL.canParse(db) && new URL(db).port === PROD_DB_PORT) {
    console.error(`mcp:smoke: DATABASE_URL is on port ${PROD_DB_PORT}, which is production.`);
    return null;
  }
  return url;
}

function check(label: string): void {
  console.log(`  ok  ${label}`);
}

/** A minimal MCP client: numbers its requests, and once told the agreed
 *  version, sends it on every request after `initialize`, as a real one does. */
function client(url: URL, secret: string) {
  let nextId = 1;
  let protocolVersion: string | null = null;

  return {
    agree(version: string) {
      protocolVersion = version;
    },

    request(method: string, params?: Record<string, unknown>) {
      return { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
    },

    /**
     * `authorization` replaces the token's header (null sends none), and
     * `body` replaces the encoded message, for the requests that must fail.
     */
    async send(
      message: Record<string, unknown> | null,
      options: { authorization?: string | null; body?: string; method?: string } = {},
    ): Promise<Response> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const authorization =
        options.authorization === undefined ? `Bearer ${secret}` : options.authorization;
      if (authorization !== null) headers.authorization = authorization;
      if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;

      try {
        return await fetch(url, {
          method: options.method ?? 'POST',
          headers,
          body: options.body ?? (message ? JSON.stringify(message) : undefined),
        });
      } catch (err) {
        throw new Error(`could not reach ${url} — is the dev server running?`, { cause: err });
      }
    },
  };
}

/** The `result` of a 200 `application/json` response. */
async function resultOf(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200, `expected 200, got ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const body = (await response.json()) as { result?: Record<string, unknown> };
  assert.ok(body.result, `expected a result, got ${JSON.stringify(body)}`);
  return body.result;
}

async function main() {
  const url = target();
  if (!url) {
    process.exitCode = 1;
    return;
  }

  let minted: { userId: string; tokenId: string } | null = null;
  try {
    const user = await getFirstUser();
    if (!user) throw new Error('no users exist — run `npm run db:seed` first');

    const { token, secret } = await createApiToken(user.id, 'mcp-smoke');
    minted = { userId: user.id, tokenId: token.id };
    const mcp = client(url, secret);

    console.log(`mcp:smoke against ${url}`);

    const initialize = mcp.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'resumix-mcp-smoke', version: '0' },
    });

    // C2: only an rmx_ token opens the door, and it is checked first, before
    // the body is parsed and before the method is considered.
    const anonymous = await mcp.send(initialize, { authorization: null });
    assert.equal(anonymous.status, 401, `no token: expected 401, got ${anonymous.status}`);
    check('no token is 401');

    const foreign = await mcp.send(initialize, { authorization: 'Bearer abc' });
    assert.equal(foreign.status, 401, `Bearer abc: expected 401, got ${foreign.status}`);
    check('a bearer credential that is not rmx_ is 401');

    const unparsed = await mcp.send(null, { authorization: null, body: '{not json' });
    assert.equal(unparsed.status, 401, `no token, bad JSON: expected 401, got ${unparsed.status}`);
    check('no token is 401 even when the body is not JSON');

    const anonymousGet = await mcp.send(null, { authorization: null, method: 'GET' });
    assert.equal(
      anonymousGet.status,
      401,
      `no token, GET: expected 401, got ${anonymousGet.status}`,
    );
    check('no token is 401 on GET too, not 405');

    const initResponse = await mcp.send(initialize);
    const init = await resultOf(initResponse);
    assert.equal(init.protocolVersion, PROTOCOL_VERSION);
    assert.ok((init.capabilities as Record<string, unknown> | undefined)?.tools);
    assert.equal(initResponse.headers.get('mcp-session-id'), null, 'no session id is issued');
    mcp.agree(PROTOCOL_VERSION);
    check(`initialize is 200 application/json, protocol ${PROTOCOL_VERSION}, no session id`);

    const initialized = await mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(initialized.status, 202);
    assert.equal(await initialized.text(), '');
    check('notifications/initialized is 202 with an empty body');

    const list = await resultOf(await mcp.send(mcp.request('tools/list')));
    const tools = list.tools as { name: string; inputSchema: { type?: string } }[];
    const pingTool = tools.find((t) => t.name === 'ping');
    assert.ok(pingTool, `tools/list has no ping: ${tools.map((t) => t.name).join(', ')}`);
    assert.equal(pingTool.inputSchema.type, 'object');
    check(`tools/list has ${tools.length} tool(s), including ping`);

    const call = await resultOf(
      await mcp.send(mcp.request('tools/call', { name: 'ping', arguments: {} })),
    );
    assert.equal(call.isError, undefined, `ping failed: ${JSON.stringify(call)}`);
    const content = call.content as { type: string; text: string }[];
    assert.equal(content[0]?.text, user.email);
    check(`the ping tool answers ${user.email}`);

    const get = await mcp.send(null, { method: 'GET' });
    assert.equal(get.status, 405, `GET: expected 405, got ${get.status}`);
    check('GET is 405');

    console.log('mcp:smoke passed');
  } finally {
    // Revoked, not deleted: tokens are never deleted (D-039).
    if (minted) await revokeApiToken(minted.userId, minted.tokenId);
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
