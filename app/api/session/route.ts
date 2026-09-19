import { getAuthMode } from '@/lib/auth-mode';
import { withApiErrors } from '@/lib/http';
import { requireUser } from '@/lib/session';
import type { SessionInfo } from '@/lib/types';

/**
 * Who am I? The browser calls this on load instead of assuming a stored
 * token means "logged in": in `dev` mode there is no token at all, and the
 * answer is whichever user the seed created.
 *
 * `401` here is the signal to show the login screen.
 */
export async function GET(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const user = await requireUser(request);
    const body: SessionInfo = { user, mode: getAuthMode() };
    return Response.json(body);
  });
}
