/**
 * Query-layer error types. Route handlers catch these and map them to the
 * right HTTP status instead of leaking a raw stack trace (docs/API.md).
 */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** A request that is well-formed JSON/shape but refers to something invalid
 * (a dangling id, deleting the default resume, etc.) — maps to 400. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

/** No usable session could be resolved for the request — maps to 401.
 * Distinct from `NotFoundError` on purpose: asking for another user's
 * resume must look exactly like asking for one that does not exist, so
 * ownership is never leaked by the status code (see `lib/session.ts`). */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}
