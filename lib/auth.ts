/**
 * Password gate: mint + verify an HMAC-SHA256 token.
 *
 * Runs in the Edge runtime (Next.js middleware), so this file must only use
 * Web Crypto (`crypto.subtle`) — never `node:crypto`. It also runs fine in
 * the Node runtime (route handlers, tests) since Web Crypto is a Node global
 * too.
 *
 * Token format: `base64url(payload-json).base64url(hmac-sha256-signature)`.
 * Payload is `{ v: 2, sub: <user id>, iat: <ms>, exp: <ms> }`. The signature
 * covers the raw base64url-encoded payload string (not the decoded bytes),
 * so any bit flip in either half invalidates the token.
 *
 * `sub` is the `users.id` the token authenticates as — this is the only
 * thing that makes the password gate compatible with a multi-user database.
 * Bumping the version to 2 invalidates every token minted before that
 * column existed, which is correct: those tokens name no user.
 *
 * This module knows nothing about *which* user should be handed out for a
 * given password — that is `lib/session.ts`'s job, because it needs the
 * database and this file must stay Edge-safe.
 */

const TOKEN_VERSION = 2;
const DEFAULT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

interface TokenPayload {
  v: number;
  /** `users.id` this token authenticates as. */
  sub: string;
  iat: number;
  exp: number;
}

/** What a valid token proves. */
export interface TokenClaims {
  userId: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// TS's DOM lib types `TextEncoder#encode` as `Uint8Array<ArrayBufferLike>`, which
// `crypto.subtle`'s `BufferSource` params reject (they want `ArrayBuffer`
// specifically, excluding `SharedArrayBuffer`). The cast is safe: `TextEncoder`
// never returns a `SharedArrayBuffer`-backed view.
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    asBufferSource(textToBytes(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(payloadB64: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, asBufferSource(textToBytes(payloadB64)));
  return toBase64Url(new Uint8Array(sig));
}

/** SHA-256 digest, hex-encoded. Used so comparisons never operate on raw secrets. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(textToBytes(value)));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Timing-safe comparison of two equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Timing-safe comparison of two strings by comparing their SHA-256 digests. */
async function timingSafeStringsEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return timingSafeEqualHex(digestA, digestB);
}

function getEnv(name: 'APP_PASSWORD' | 'AUTH_SECRET'): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/**
 * Checks a submitted password against `APP_PASSWORD` in constant time.
 * Fails closed (returns false) if either env var is missing — never falls
 * back to a default password.
 *
 * Deliberately does *not* mint a token: the token has to name a user, and
 * resolving which user that is requires the database. `lib/session.ts`
 * composes the two.
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const appPassword = getEnv('APP_PASSWORD');
  const authSecret = getEnv('AUTH_SECRET');
  if (!appPassword || !authSecret) {
    console.error(
      '[auth] APP_PASSWORD or AUTH_SECRET is unset — rejecting all logins. Set both in .env.',
    );
    return false;
  }

  return timingSafeStringsEqual(password, appPassword);
}

/** The configured signing secret, or null when unset (callers fail closed). */
export function getAuthSecret(): string | null {
  return getEnv('AUTH_SECRET') ?? null;
}

/** Mints a signed token for `userId`. `ttlMs`/`now` are parameters so tests
 *  can mint an already-expired token. */
export async function mintToken(
  secret: string,
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS,
  now: number = Date.now(),
): Promise<string> {
  const payload: TokenPayload = { v: TOKEN_VERSION, sub: userId, iat: now, exp: now + ttlMs };
  const payloadB64 = toBase64Url(textToBytes(JSON.stringify(payload)));
  const sigB64 = await sign(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies a token's signature, version, and expiry, returning the claims it
 * carries — or `null` for anything that fails. Fails closed if `AUTH_SECRET`
 * is unset.
 *
 * A `null` return is the only "invalid" signal; callers must not try to read
 * the payload themselves.
 */
export async function verifyToken(
  token: string | null | undefined,
  secretOverride?: string,
): Promise<TokenClaims | null> {
  if (!token) return null;

  const secret = secretOverride ?? getEnv('AUTH_SECRET');
  if (!secret) {
    console.error('[auth] AUTH_SECRET is unset — rejecting all tokens.');
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  let expectedSig: string;
  try {
    expectedSig = await sign(payloadB64, secret);
  } catch {
    return null;
  }

  const sigOk = await timingSafeStringsEqual(sigB64, expectedSig);
  if (!sigOk) return null;

  let payload: TokenPayload;
  try {
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    payload = JSON.parse(json) as TokenPayload;
  } catch {
    return null;
  }

  if (payload.v !== TOKEN_VERSION) return null;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;

  return { userId: payload.sub };
}
