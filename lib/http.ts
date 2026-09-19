/**
 * Small shared plumbing so route handlers stay thin: parse+validate a JSON
 * body against a zod schema, and map query-layer errors to the right HTTP
 * status without ever leaking a raw stack trace (docs/API.md, "Errors").
 */
import type { ZodType } from 'zod';
import { BadRequestError, NotFoundError } from './queries/errors.ts';

export function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Thrown by `parseJsonBody` on invalid JSON or a failed schema check;
 * callers don't need to catch this directly — `withApiErrors` does. */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new BadRequestError('invalid JSON body');
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new BadRequestError(`${path}${issue?.message ?? 'invalid request body'}`);
  }
  return result.data;
}

/**
 * Wraps a route handler body: `BadRequestError` -> 400, `NotFoundError` ->
 * 404, anything else -> 500 with a generic message (logged server-side,
 * never returned to the client).
 */
export async function withApiErrors(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof BadRequestError) return errorResponse(err.message, 400);
    if (err instanceof NotFoundError) return errorResponse(err.message, 404);
    console.error(err);
    return errorResponse('internal server error', 500);
  }
}
