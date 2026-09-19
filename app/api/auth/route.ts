import { getAuthMode } from '@/lib/auth-mode';
import { parseJsonBody, withApiErrors } from '@/lib/http';
import { BadRequestError, UnauthorizedError } from '@/lib/queries/errors';
import { loginWithPassword } from '@/lib/session';
import { loginSchema } from '@/lib/validation';

/**
 * The password gate, and the only unauthenticated route — `middleware.ts`
 * exempts it, or there would be no way to obtain a token.
 *
 * Only meaningful in `password` mode: `dev` needs no login at all, and
 * `supabase` mode authenticates in the browser against Supabase, never
 * against this route.
 */
export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const mode = getAuthMode();
    if (mode !== 'password') {
      throw new BadRequestError(`password login is not available in "${mode}" auth mode`);
    }

    const { password } = await parseJsonBody(request, loginSchema);

    const token = await loginWithPassword(password);
    if (!token) throw new UnauthorizedError('unauthorized');

    return Response.json({ token });
  });
}
