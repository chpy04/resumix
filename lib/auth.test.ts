import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, mintToken, verifyToken } from './auth.ts';

const SECRET = 'test-auth-secret';
const PASSWORD = 'correct-horse-battery-staple';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('valid password mints a token', async () => {
  const token = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET }, () =>
    login(PASSWORD),
  );
  assert.ok(token);
  assert.match(token!, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('wrong password fails login (401 at the route level)', async () => {
  const token = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET }, () => login('nope'));
  assert.equal(token, null);
});

test('a freshly minted, valid token verifies', async () => {
  const token = await mintToken(SECRET);
  const ok = await verifyToken(token, SECRET);
  assert.equal(ok, true);
});

test('a tampered signature fails verification', async () => {
  const token = await mintToken(SECRET);
  const [payload, sig] = token.split('.');
  const flippedChar = sig![0] === 'A' ? 'B' : 'A';
  const tampered = `${payload}.${flippedChar}${sig!.slice(1)}`;
  const ok = await verifyToken(tampered, SECRET);
  assert.equal(ok, false);
});

test('a tampered payload fails verification', async () => {
  const token = await mintToken(SECRET);
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ v: 1, iat: 0, exp: Date.now() + 1e12 }),
  ).toString('base64url');
  const tampered = `${forgedPayload}.${sig}`;
  const ok = await verifyToken(tampered, SECRET);
  assert.equal(ok, false);
});

test('an expired token fails verification', async () => {
  const past = Date.now() - 1000;
  const token = await mintToken(SECRET, -1, past);
  const ok = await verifyToken(token, SECRET);
  assert.equal(ok, false);
});

test('a token signed with a different secret fails verification', async () => {
  const token = await mintToken(SECRET);
  const ok = await verifyToken(token, 'a-completely-different-secret');
  assert.equal(ok, false);
});

test('missing APP_PASSWORD fails closed on login', async () => {
  const token = await withEnv({ APP_PASSWORD: undefined, AUTH_SECRET: SECRET }, () =>
    login(PASSWORD),
  );
  assert.equal(token, null);
});

test('missing AUTH_SECRET fails closed on login', async () => {
  const token = await withEnv({ APP_PASSWORD: PASSWORD, AUTH_SECRET: undefined }, () =>
    login(PASSWORD),
  );
  assert.equal(token, null);
});

test('missing AUTH_SECRET fails closed on verify (no secretOverride)', async () => {
  const token = await mintToken(SECRET);
  const ok = await withEnv({ AUTH_SECRET: undefined }, () => verifyToken(token));
  assert.equal(ok, false);
});

test('malformed tokens are rejected without throwing', async () => {
  assert.equal(await verifyToken(null, SECRET), false);
  assert.equal(await verifyToken('', SECRET), false);
  assert.equal(await verifyToken('not-a-token', SECRET), false);
  assert.equal(await verifyToken('a.b.c', SECRET), false);
});
