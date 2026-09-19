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
