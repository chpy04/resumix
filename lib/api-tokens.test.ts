import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_TOKEN_PREFIX,
  apiTokenFromRequest,
  generateApiTokenSecret,
  hashApiTokenSecret,
} from './api-tokens.ts';

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/mcp', { headers });
}

test('a secret is rmx_ plus 43 base64url characters', () => {
  const secret = generateApiTokenSecret();
  assert.match(secret, /^rmx_[A-Za-z0-9_-]{43}$/);
  assert.ok(secret.startsWith(API_TOKEN_PREFIX));
});

test('two secrets are never the same', () => {
  assert.notEqual(generateApiTokenSecret(), generateApiTokenSecret());
});

test('the hash is 64 hex characters, and the same secret always hashes the same', () => {
  // Deterministic is the point: the lookup is an equality on the stored hash.
  const secret = generateApiTokenSecret();
  const hash = hashApiTokenSecret(secret);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hashApiTokenSecret(secret), hash);
  assert.notEqual(hashApiTokenSecret(generateApiTokenSecret()), hash);
  assert.ok(!hash.includes(secret.slice(API_TOKEN_PREFIX.length)));
});

test('apiTokenFromRequest reads Authorization: Bearer rmx_…', () => {
  const secret = generateApiTokenSecret();
  assert.equal(apiTokenFromRequest(request({ authorization: `Bearer ${secret}` })), secret);
  // The scheme is case-insensitive; the secret is not altered.
  assert.equal(apiTokenFromRequest(request({ authorization: `bearer ${secret}` })), secret);
  assert.equal(apiTokenFromRequest(request({ authorization: `BEARER  ${secret}` })), secret);
});

test('apiTokenFromRequest ignores everything that is not a bearer rmx_ token', () => {
  const secret = generateApiTokenSecret();
  assert.equal(apiTokenFromRequest(request({})), null);
  assert.equal(apiTokenFromRequest(request({ authorization: `Basic ${secret}` })), null);
  assert.equal(apiTokenFromRequest(request({ authorization: 'Bearer not-ours' })), null);
  assert.equal(apiTokenFromRequest(request({ authorization: `Bearer ${secret} extra` })), null);
  assert.equal(apiTokenFromRequest(request({ authorization: secret })), null);
  // The password session's header is never a fallback, even holding a real secret.
  assert.equal(apiTokenFromRequest(request({ 'x-resumix-token': secret })), null);
});
