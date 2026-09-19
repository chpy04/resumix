/**
 * Pure helper: decode a base64 PDF payload (as returned by `POST /render`
 * and `POST /pdf`) into a `blob:` object URL react-pdf / an `<iframe>` can
 * point at. No React, no fetch — kept separate so it's trivially testable.
 */
export function base64PdfToObjectUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}
