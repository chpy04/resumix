import { parseJsonBody, withApiErrors } from '@/lib/http';
import { login } from '@/lib/auth';
import { loginSchema } from '@/lib/validation';

/**
 * The only unauthenticated route — `middleware.ts` exempts it, or there
 * would be no way to obtain a token. Otherwise it follows the same
 * parse-then-delegate shape as every other handler (docs/API.md).
 */
export async function POST(request: Request): Promise<Response> {
  return withApiErrors(async () => {
    const { password } = await parseJsonBody(request, loginSchema);

    const token = await login(password);
    if (!token) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    return Response.json({ token });
  });
}
