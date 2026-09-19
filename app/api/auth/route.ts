import { login } from '@/lib/auth';

export async function POST(request: Request): Promise<Response> {
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

  const token = await login(password);
  if (!token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  return Response.json({ token });
}
