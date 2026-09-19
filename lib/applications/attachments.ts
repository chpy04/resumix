/**
 * The two rules an uploaded attachment has to obey, kept pure so they can be
 * tested without a request: how big it may be, and what content type we are
 * willing to hand back.
 *
 * Attachments are deliberately untyped as far as the user is concerned — any
 * file, no `kind` column (D-031). "Untyped" is not the same as "trusted",
 * though: the bytes come back out over HTTP, so the response's content type
 * is drawn from a fixed list rather than echoed from whatever the browser
 * claimed at upload time.
 */

/** Comfortably under Vercel's 4.5 MB request-body ceiling, matching the
 *  screenshot limit the feedback widget already works to. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** Types safe to name in a response. Everything else is served as an opaque
 *  download, so an uploaded `.html` cannot come back as a live page on this
 *  origin. Every response is `Content-Disposition: attachment` regardless. */
const SERVABLE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'text/plain',
]);

export function servableContentType(storedType: string): string {
  return SERVABLE_TYPES.has(storedType) ? storedType : 'application/octet-stream';
}

/**
 * A filename safe to store and to put in a `Content-Disposition` header:
 * no directory components (a browser may send a relative path), no quotes,
 * no control characters, never empty.
 */
export function sanitizeAttachmentFilename(raw: string): string {
  const flattened = raw
    .replace(/[\\/]+/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/["\x00-\x1f\x7f]/g, '')
    .trim();
  return flattened.length > 0 ? flattened.slice(0, 200) : 'attachment';
}
