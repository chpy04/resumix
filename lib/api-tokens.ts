/**
 * API tokens: what a secret looks like, how it is hashed, and where a request
 * carries it (D-039). Pure; the table lives behind `lib/queries/api-tokens.ts`.
 *
 * Node-only. This uses `node:crypto`, so nothing reachable from
 * `middleware.ts` may import it (CLAUDE.md invariant 4), and ESLint rejects
 * the import in every Edge file. Middleware never needs it: it lets
 * `/api/mcp/**` straight through and the route handler does the check.
 */
import { createHash, randomBytes } from 'node:crypto';

/** Marks a string as one of ours, so a leaked secret is recognisable for
 *  what it is, and so the password-mode token can never be mistaken for it. */
export const API_TOKEN_PREFIX = 'rmx_';

/** `rmx_` plus 32 random bytes as base64url: 47 characters, 256 bits. */
export function generateApiTokenSecret(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/**
 * Hex sha-256 — the only form a secret is stored in.
 *
 * Unsalted and fast on purpose. Salts and slow hashes exist to protect
 * secrets people choose, which can be guessed; this one is 256 random bits,
 * so there is nothing to guess and no table to precompute. A deterministic
 * hash is also what lets the lookup be one equality on a unique index.
 */
export function hashApiTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * The secret from `Authorization: Bearer rmx_…`, or null.
 *
 * Reads that one header and nothing else. `x-resumix-token` is the password
 * session's header and is deliberately not a fallback, and a bearer value
 * without the prefix is not ours to look up. The scheme is case-insensitive
 * (RFC 9110); the secret is not.
 */
export function apiTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const secret = match?.[1];
  return secret && secret.startsWith(API_TOKEN_PREFIX) ? secret : null;
}
