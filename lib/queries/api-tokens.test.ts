/**
 * API tokens against a real database (D-039).
 *
 * Every test mints its tokens for a fresh account from `insertUser`, never
 * the seeded user, so nothing here leaves a working credential on the account
 * dev mode logs in as. Tokens are revoked rather than deleted in the app, and
 * these are left behind with their throwaway owners the same way.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

// Only touch DB-backed modules when DATABASE_URL is set: `lib/db/index.ts`
// throws at import time otherwise, which would fail this whole file even
// though every test below is marked `{ skip }`.
let generateApiTokenSecret: typeof import('../api-tokens.ts').generateApiTokenSecret;
let hashApiTokenSecret: typeof import('../api-tokens.ts').hashApiTokenSecret;
let authenticateApiToken: typeof import('./api-tokens.ts').authenticateApiToken;
let createApiToken: typeof import('./api-tokens.ts').createApiToken;
let revokeApiToken: typeof import('./api-tokens.ts').revokeApiToken;
let fixtures: typeof import('./test-fixtures.ts');

if (!skip) {
  ({ generateApiTokenSecret, hashApiTokenSecret } = await import('../api-tokens.ts'));
  ({ authenticateApiToken, createApiToken, revokeApiToken } = await import('./api-tokens.ts'));
  fixtures = await import('./test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

async function newOwner() {
  return fixtures.insertUser(`tok-${fixtures.testTag()}`);
}

test('only the hash of the secret is stored', { skip }, async () => {
  const owner = await newOwner();
  const { token, secret } = await createApiToken(owner.id, 'laptop agent');

  const row = await fixtures.getApiTokenRow(token.id);
  assert.equal(row.tokenHash, hashApiTokenSecret(secret));
  assert.equal(row.userId, owner.id);
  assert.equal(row.label, 'laptop agent');

  // No column holds the secret, whole or in part.
  const body = secret.slice('rmx_'.length);
  for (const [column, value] of Object.entries(row)) {
    assert.ok(!String(value).includes(body), `${column} must not hold the secret`);
  }

  // ...and neither does what the query layer hands back.
  assert.deepEqual(Object.keys(token).sort(), [
    'createdAt',
    'id',
    'label',
    'lastUsedAt',
    'revokedAt',
  ]);
  assert.equal(token.lastUsedAt, null);
  assert.equal(token.revokedAt, null);
});

test('a live token authenticates as its owner and stamps last_used_at', { skip }, async () => {
  const owner = await newOwner();
  const { token, secret } = await createApiToken(owner.id, 'agent');

  const user = await authenticateApiToken(secret);
  assert.equal(user?.id, owner.id);
  assert.equal(user?.email, owner.email);

  const row = await fixtures.getApiTokenRow(token.id);
  assert.ok(row.lastUsedAt, 'a successful call must record when it happened');
});

test('a revoked token returns null and leaves last_used_at alone', { skip }, async () => {
  const owner = await newOwner();
  const { token, secret } = await createApiToken(owner.id, 'agent');
  await revokeApiToken(owner.id, token.id);

  assert.equal(await authenticateApiToken(secret), null);

  const row = await fixtures.getApiTokenRow(token.id);
  assert.equal(row.lastUsedAt, null, 'a refused call is not a use');
  assert.ok(row.revokedAt);
});

test('an unknown token returns null and touches no row', { skip }, async () => {
  const owner = await newOwner();
  const { token } = await createApiToken(owner.id, 'agent');

  assert.equal(await authenticateApiToken(generateApiTokenSecret()), null);
  assert.equal(await authenticateApiToken(''), null);

  const row = await fixtures.getApiTokenRow(token.id);
  assert.equal(row.lastUsedAt, null);
});

test('revoking twice keeps the first revoked_at', { skip }, async () => {
  const owner = await newOwner();
  const { token } = await createApiToken(owner.id, 'agent');

  const first = await revokeApiToken(owner.id, token.id);
  assert.ok(first.revokedAt);
  // `now()` is per transaction, so the second statement would stamp a later
  // time if `coalesce` were not keeping the first.
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = await revokeApiToken(owner.id, token.id);
  assert.equal(second.revokedAt, first.revokedAt);
});
