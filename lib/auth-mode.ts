/**
 * Which authentication scheme is in force.
 *
 * Imported by `middleware.ts`, so this file must stay Edge-safe: no Node
 * builtins, no database, nothing but `process.env`.
 *
 * - `dev`      — no login at all; the session is the first user in the
 *                `users` table (the one `npm run db:seed` creates). Local
 *                development only.
 * - `password` — the shared `APP_PASSWORD` gate, minting a signed token
 *                bound to one user. This is what shipped before multi-user
 *                existed and is still the only working non-local path.
 * - `supabase` — Supabase OAuth. Not implemented yet; the seam is
 *                `lib/auth-supabase.ts`, which fails closed until it is.
 *
 * Defaults to `dev` outside production and `password` in production, so
 * deploying can never silently disable the login screen. Override with
 * `RESUMIX_AUTH_MODE`.
 */

export type AuthMode = 'dev' | 'password' | 'supabase';

const MODES: readonly AuthMode[] = ['dev', 'password', 'supabase'];

export function getAuthMode(): AuthMode {
  const raw = process.env.RESUMIX_AUTH_MODE?.trim().toLowerCase();

  if (raw && raw.length > 0) {
    if (!MODES.includes(raw as AuthMode)) {
      throw new Error(
        `RESUMIX_AUTH_MODE="${raw}" is not one of: ${MODES.join(', ')}`,
      );
    }
    return raw as AuthMode;
  }

  return process.env.NODE_ENV === 'production' ? 'password' : 'dev';
}

/** True when the app auto-logs in as the seeded user. Never true in production
 *  unless `RESUMIX_AUTH_MODE=dev` was set there deliberately. */
export function isDevAuth(): boolean {
  return getAuthMode() === 'dev';
}
