/**
 * API tokens, the credential `/api/mcp/**` accepts (D-039).
 *
 * Only the sha-256 of a secret is ever written. The secret itself exists
 * once, in `createApiToken`'s return value, and nothing can read it back.
 * Tokens are revoked, never deleted, so a row stays a record of what had
 * access and when it last used it.
 *
 * `createApiToken` and `revokeApiToken` take the owner's `userId` first, like
 * every other query module. `authenticateApiToken` cannot: it is how a
 * request gets a user id in the first place.
 */
import { and, eq, isNull, sql as raw } from 'drizzle-orm';
import { generateApiTokenSecret, hashApiTokenSecret } from '../api-tokens.ts';
import { db } from '../db/index.ts';
import { apiToken } from '../db/schema.ts';
import type { ApiToken, User } from '../types.ts';
import { NotFoundError } from './errors.ts';
import { getUserById } from './users.ts';

type ApiTokenRow = typeof apiToken.$inferSelect;

function toWire(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** Mints a token. `secret` is the caller's one chance to see it. */
export async function createApiToken(
  userId: string,
  label: string,
): Promise<{ token: ApiToken; secret: string }> {
  const secret = generateApiTokenSecret();
  const [row] = await db
    .insert(apiToken)
    .values({ userId, label, tokenHash: hashApiTokenSecret(secret) })
    .returning();
  if (!row) throw new Error('failed to create API token');

  return { token: toWire(row), secret };
}

/**
 * Revokes one of this user's tokens. Idempotent: revoking it again keeps the
 * first `revoked_at`, which is the date that matters. Somebody else's token
 * reads as not found, the same as one that does not exist.
 */
export async function revokeApiToken(userId: string, id: string): Promise<ApiToken> {
  const [row] = await db
    .update(apiToken)
    .set({ revokedAt: raw`coalesce(${apiToken.revokedAt}, now())` })
    .where(and(eq(apiToken.id, id), eq(apiToken.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError(`API token ${id} not found`);

  return toWire(row);
}

/**
 * The owner of a live token, or null for an unknown or revoked one.
 *
 * Like `lib/queries/users.ts`, this *produces* a user id rather than being
 * scoped by one, so it is the one function here that takes none.
 *
 * One statement stamps `last_used_at` and checks `revoked_at` together, so
 * there is no gap between "is it revoked?" and "use it" for a revoke to fall
 * into. An unknown or revoked token matches no row and so writes nothing.
 */
export async function authenticateApiToken(secret: string): Promise<User | null> {
  const [row] = await db
    .update(apiToken)
    .set({ lastUsedAt: raw`now()` })
    .where(and(eq(apiToken.tokenHash, hashApiTokenSecret(secret)), isNull(apiToken.revokedAt)))
    .returning({ userId: apiToken.userId });
  if (!row) return null;

  return getUserById(row.userId);
}
