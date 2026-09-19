import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintToken, verifyPassword, verifyToken } from './auth.ts';

const SECRET = 'test-auth-secret';
const PASSWORD = 'correct-horse-battery-staple';
const USER_ID = '11111111-2222-3333-4444-555555555555';

/**
 * Runs `fn` with `env` applied, restoring the previous values afterwards.
 *
 * Awaits the result *inside* the try: every function under test here is
 * async, and a synchronous `finally` would restore the environment the
 * instant `fn` returned its promise — before the code inside it had read
 * `process.env` past its first `await`. That fails in exactly one
 * direction, silently making "fails closed" assertions pass for the wrong
 * reason.
 */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('the correct password verifies', async () => {
  const ok = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET }, () =>
    verifyPassword(PASSWORD),
  );
  assert.equal(ok, true);
});

test('wrong password fails verification (401 at the route level)', async () => {
  const ok = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET }, () =>
    verifyPassword('nope'),
  );
  assert.equal(ok, false);
});

test('a freshly minted, valid token verifies and names its user', async () => {
  const token = await mintToken(SECRET, USER_ID);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const claims = await verifyToken(token, SECRET);
  assert.deepEqual(claims, { userId: USER_ID });
});

test('a token for one user never verifies as another', async () => {
  const other = '99999999-8888-7777-6666-555555555555';
  const token = await mintToken(SECRET, USER_ID);
  const claims = await verifyToken(token, SECRET);
  assert.notEqual(claims?.userId, other);
});

test('a tampered signature fails verification', async () => {
  const token = await mintToken(SECRET, USER_ID);
  const [payload, sig] = token.split('.');
  const flippedChar = sig![0] === 'A' ? 'B' : 'A';
  const tampered = `${payload}.${flippedChar}${sig!.slice(1)}`;
  assert.equal(await verifyToken(tampered, SECRET), null);
});

test('a tampered payload fails verification', async () => {
  const token = await mintToken(SECRET, USER_ID);
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ v: 2, sub: USER_ID, iat: 0, exp: Date.now() + 1e12 }),
  ).toString('base64url');
  const tampered = `${forgedPayload}.${sig}`;
  assert.equal(await verifyToken(tampered, SECRET), null);
});

test('swapping in another user id invalidates the signature', async () => {
  // The whole point of signing the payload: a token cannot be re-pointed at
  // someone else's account by editing the `sub` claim.
  const token = await mintToken(SECRET, USER_ID);
  const [, sig] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ v: 2, sub: 'somebody-else', iat: Date.now(), exp: Date.now() + 1e12 }),
  ).toString('base64url');
  assert.equal(await verifyToken(`${forged}.${sig}`, SECRET), null);
});

test('a pre-multi-user (v1) token is rejected', async () => {
  // v1 tokens named no user, so there is nothing to scope their queries to.
  // The version bump has to invalidate them rather than default them to
  // somebody.
  const payload = Buffer.from(
    JSON.stringify({ v: 1, iat: Date.now(), exp: Date.now() + 1e12 }),
  ).toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = Buffer.from(new Uint8Array(sigBytes)).toString('base64url');

  assert.equal(await verifyToken(`${payload}.${sig}`, SECRET), null);
});

test('an expired token fails verification', async () => {
  const past = Date.now() - 1000;
  const token = await mintToken(SECRET, USER_ID, -1, past);
  assert.equal(await verifyToken(token, SECRET), null);
});

test('a token signed with a different secret fails verification', async () => {
  const token = await mintToken(SECRET, USER_ID);
  assert.equal(await verifyToken(token, 'a-completely-different-secret'), null);
});

test('missing APP_PASSWORD fails closed', async () => {
  const ok = await withEnv({ APP_PASSWORD: undefined, AUTH_SECRET: SECRET }, () =>
    verifyPassword(PASSWORD),
  );
  assert.equal(ok, false);
});

test('missing AUTH_SECRET fails closed on password check', async () => {
  const ok = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: undefined }, () =>
    verifyPassword(PASSWORD),
  );
  assert.equal(ok, false);
});

test('missing AUTH_SECRET fails closed on verify (no secretOverride)', async () => {
  const token = await mintToken(SECRET, USER_ID);
  const claims = await withEnv({ AUTH_SECRET: undefined }, () => verifyToken(token));
  assert.equal(claims, null);
});

test('malformed tokens are rejected without throwing', async () => {
  assert.equal(await verifyToken(null, SECRET), null);
  assert.equal(await verifyToken('', SECRET), null);
  assert.equal(await verifyToken('not-a-token', SECRET), null);
  assert.equal(await verifyToken('a.b.c', SECRET), null);
});
