import { NextResponse, type NextRequest } from 'next/server';
import { getAuthMode, isMcpPath } from '@/lib/auth-mode';
import { verifyToken } from '@/lib/auth';

/**
 * Guards `/api/*` (except `/api/auth`, or you could never log in). Runs on
 * the Edge runtime, so everything it imports must stick to Web Crypto — no
 * `node:crypto`, and no database access at all.
 *
 * This is only half the check, and deliberately the cheap half: it can
 * reject a request that carries no valid token, but it cannot say *which
 * user* the request is for, because that needs the `users` table. Route
 * handlers resolve the caller themselves via `requireUserId()`
 * (`lib/session.ts`), which fails closed for every mode. Nothing here is
 * load-bearing for user isolation — the scoping happens in the queries.
 *
 * `/api/mcp/**` is not checked here at all: its API tokens can only be told
 * apart by a database lookup, so the handler does the whole check.
 *
 * Always returns JSON, never a redirect: every caller here is `fetch`, not
 * a browser navigation.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (pathname === '/api/auth') {
    return NextResponse.next();
  }

  if (isMcpPath(pathname)) {
    // API tokens, in every auth mode (D-039). `requireMcpUserId` in the
    // handler checks the token against `api_token` and answers 401 itself,
    // so passing through here is still fail-closed. The password-mode check
    // below must not run: it would demand `x-resumix-token`, which an agent
    // never has.
    return NextResponse.next();
  }

  switch (getAuthMode()) {
    case 'dev':
      // No login in dev mode; `requireUserId` resolves the seeded user.
      return NextResponse.next();

    case 'password': {
      const claims = await verifyToken(request.headers.get('x-resumix-token'));
      if (!claims) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return NextResponse.next();
    }

    case 'supabase':
      // JWT verification needs JWKS and is not implemented yet
      // (lib/auth-supabase.ts). `requireUserId` rejects every request in
      // this mode, so passing through here is still fail-closed.
      return NextResponse.next();
  }
}

export const config = {
  matcher: ['/api/:path*'],
};
