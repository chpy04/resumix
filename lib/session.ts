/**
 * Who is making this request?
 *
 * Every route handler starts by calling `requireUserId(request)` and every
 * query function it then calls takes that id. That is the whole multi-user
 * enforcement story: there is no ambient "current user", and no query can
 * run without one being named explicitly.
 *
 * Server-only — this touches the database, so it can never be imported from
 * `middleware.ts` (Edge) or from anything under `components/**`. Middleware
 * does the cheap, DB-free half of the check; this does the rest.
 *
 * The three modes are described in `lib/auth-mode.ts`.
 */
import { getAuthMode } from './auth-mode.ts';
import { getAuthSecret, mintToken, verifyPassword, verifyToken } from './auth.ts';
import { verifySupabaseAccessToken } from './auth-supabase.ts';
import { UnauthorizedError } from './queries/errors.ts';
import {
  countUsers,
  getFirstUser,
  getUserByEmail,
  getUserById,
  getUserBySupabaseUserId,
  linkSupabaseUserId,
  provisionUser,
} from './queries/users.ts';
import type { User } from './types.ts';

export const TOKEN_HEADER = 'x-resumix-token';

function bearerToken(request: Request): string | null {
  return request.headers.get(TOKEN_HEADER);
}

/**
 * `dev` mode: the session is simply the first user in the table — the one
 * `npm run db:seed` creates. No login screen, no token, no password.
 */
async function devUser(): Promise<User> {
  const user = await getFirstUser();
  if (!user) {
    throw new UnauthorizedError(
      'no users exist yet — run `npm run db:seed` to create one (dev auth mode)',
    );
  }
  return user;
}

/** `password` mode: the signed token names the user; we trust it only after
 *  confirming that user still exists. */
async function passwordUser(request: Request): Promise<User> {
  const claims = await verifyToken(bearerToken(request));
  if (!claims) throw new UnauthorizedError('unauthorized');

  const user = await getUserById(claims.userId);
  if (!user) {
    // A validly-signed token for a user that has since been removed.
    throw new UnauthorizedError('unauthorized');
  }
  return user;
}

/**
 * `supabase` mode: the identity comes from a verified Supabase JWT, and is
 * mapped onto a local `users` row by `supabase_user_id` (falling back to
 * email, which adopts any account created before OAuth was switched on).
 *
 * This whole path is written and unreachable: `verifySupabaseAccessToken`
 * throws until someone implements it (`lib/auth-supabase.ts`). It is here so
 * that implementing it is a one-file change rather than a redesign.
 */
async function supabaseUser(request: Request): Promise<User> {
  const identity = await verifySupabaseAccessToken(bearerToken(request));
  if (!identity) throw new UnauthorizedError('unauthorized');

  const existing = await getUserBySupabaseUserId(identity.supabaseUserId);
  if (existing) return existing;

  const byEmail = await getUserByEmail(identity.email);
  if (byEmail) return linkSupabaseUserId(byEmail.id, identity.supabaseUserId);

  return provisionUser({
    email: identity.email,
    name: identity.name,
    supabaseUserId: identity.supabaseUserId,
  });
}

/** Resolves the caller, or throws `UnauthorizedError` (-> 401 via `withApiErrors`). */
export async function requireUser(request: Request): Promise<User> {
  switch (getAuthMode()) {
    case 'dev':
      return devUser();
    case 'password':
      return passwordUser(request);
    case 'supabase':
      return supabaseUser(request);
  }
}

/** The common case: handlers need the id, not the whole row. */
export async function requireUserId(request: Request): Promise<string> {
  const user = await requireUser(request);
  return user.id;
}

/**
 * `POST /api/auth`, password mode only: check the shared password, then mint
 * a token bound to a specific user.
 *
 * Which user? `OWNER_EMAIL` if set, otherwise the only user in the table.
 * With more than one user and no `OWNER_EMAIL`, this refuses rather than
 * guessing — one shared password cannot distinguish between people, and
 * handing out the wrong account is worse than failing to log in. That
 * ambiguity is exactly what Supabase OAuth resolves.
 */
export async function loginWithPassword(password: string): Promise<string | null> {
  if (!(await verifyPassword(password))) return null;

  const secret = getAuthSecret();
  if (!secret) return null; // verifyPassword already logged why

  const ownerEmail = process.env.OWNER_EMAIL?.trim();
  if (ownerEmail) {
    const user = await getUserByEmail(ownerEmail);
    if (!user) {
      console.error(
        `[auth] OWNER_EMAIL="${ownerEmail}" does not match any user — rejecting login.`,
      );
      return null;
    }
    return mintToken(secret, user.id);
  }

  const total = await countUsers();
  if (total === 0) {
    console.error('[auth] no users exist — run `npm run db:seed`. Rejecting login.');
    return null;
  }
  if (total > 1) {
    console.error(
      `[auth] ${total} users exist but OWNER_EMAIL is unset, so the password gate cannot tell ` +
        'which one to log in as. Set OWNER_EMAIL, or switch to RESUMIX_AUTH_MODE=supabase.',
    );
    return null;
  }

  const user = await getFirstUser();
  if (!user) return null;
  return mintToken(secret, user.id);
}
