import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

/**
 * Guards `/api/*` (except `/api/auth`, or you could never log in). Runs on
 * the Edge runtime, so `lib/auth.ts` must stick to Web Crypto — no
 * `node:crypto`. Always returns JSON, never a redirect: every caller here is
 * `fetch`, not a browser navigation.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.pathname === '/api/auth') {
    return NextResponse.next();
  }

  const token = request.headers.get('x-resumix-token');
  const ok = await verifyToken(token);

  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
