import { getAuthMode } from '@/lib/auth-mode';
import { loginWithPassword } from '@/lib/session';

/**
 * The password gate. Only meaningful in `password` mode — `dev` needs no
 * login, and `supabase` mode authenticates in the browser against Supabase,
 * never against this route.
 */
export async function POST(request: Request): Promise<Response> {
  const mode = getAuthMode();
  if (mode !== 'password') {
    return Response.json(
      { error: `password login is not available in "${mode}" auth mode` },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const password =
    typeof body === 'object' && body !== null && 'password' in body
      ? (body as { password: unknown }).password
      : undefined;

  if (typeof password !== 'string' || password.length === 0) {
    return Response.json({ error: 'password is required' }, { status: 400 });
  }

  const token = await loginWithPassword(password);
  if (!token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  return Response.json({ token });
}
