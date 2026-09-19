/**
 * Supabase OAuth seam — **not implemented**.
 *
 * This is the one file that has to be written when the app moves to
 * Supabase Auth. Everything else already speaks in terms of a `users` row:
 * `lib/session.ts` asks this module who the caller is, looks the answer up
 * in `users.supabase_user_id`, and hands the rest of the app a local user
 * id. No query, route, or component needs to change.
 *
 * What implementing it involves:
 *
 *   1. Client: `@supabase/supabase-js` + `signInWithOAuth({ provider })`,
 *      replacing `components/LoginForm.tsx` in `supabase` mode.
 *   2. Ship the access token to the API. Either keep the existing
 *      `x-resumix-token` header (swap the value for Supabase's JWT) or move
 *      to Supabase's cookie-based session and read it here from
 *      `request.cookies`.
 *   3. Verify the JWT below against the project's JWKS
 *      (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`),
 *      checking `iss`, `aud`, and `exp`. Use `jose` — it is Edge-compatible,
 *      which `jsonwebtoken` is not, and this runs in `middleware.ts`.
 *   4. Return the token's `sub` (Supabase's user id) and `email`.
 *
 * `lib/session.ts` then maps `sub` -> `users.supabase_user_id`, provisioning
 * a row via `provisionUser()` on first sign-in. That mapping is already
 * written; only the verification below is missing.
 *
 * Edge-safe by contract: `middleware.ts` imports this transitively, so
 * whatever lands here may not use `node:crypto` or any other Node builtin.
 */

export interface SupabaseIdentity {
  /** Supabase `auth.users.id` — stored as `users.supabase_user_id`. */
  supabaseUserId: string;
  email: string;
  name: string | null;
}

export class SupabaseAuthNotConfiguredError extends Error {
  constructor() {
    super(
      'RESUMIX_AUTH_MODE=supabase, but Supabase OAuth is not implemented yet — ' +
        'see lib/auth-supabase.ts. Use RESUMIX_AUTH_MODE=password or =dev.',
    );
    this.name = 'SupabaseAuthNotConfiguredError';
  }
}

/**
 * Verifies a Supabase access token and returns who it belongs to.
 *
 * Fails closed: until this is implemented it rejects every request rather
 * than letting one through unauthenticated.
 */
export async function verifySupabaseAccessToken(
  _token: string | null | undefined,
): Promise<SupabaseIdentity | null> {
  throw new SupabaseAuthNotConfiguredError();
}
