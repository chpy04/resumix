/**
 * Browser-only screenshot preparation. Never import this from server code —
 * it touches `Image`/`canvas`.
 *
 * A macOS Retina screenshot of a full window is routinely 5–8 MB, which is
 * over Vercel's 4.5 MB request-body limit and would fail the upload outright.
 * Anything over the threshold is redrawn at most `MAX_DIMENSION` on its long
 * edge. Re-encoded as PNG, not JPEG: these are screenshots of text, and JPEG
 * ringing around glyphs is exactly the detail a bug report needs to keep.
 */

const MAX_DIMENSION = 1600;
const DOWNSCALE_OVER_BYTES = 1024 * 1024;

export async function prepareScreenshot(file: File): Promise<File> {
  if (file.size <= DOWNSCALE_OVER_BYTES) return file;

  try {
    const resized = await downscale(file);
    // Re-encoding can occasionally grow a file (e.g. an already-optimised
    // JPEG becoming PNG) — keep whichever is actually smaller.
    return resized && resized.size < file.size ? resized : file;
  } catch {
    // Not worth failing the report over; the server still accepts up to 4 MB.
    return file;
  }
}

async function downscale(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;

    const name = file.name.replace(/\.[^.]+$/, '') || 'screenshot';
    return new File([blob], `${name}.png`, { type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

/** Human-readable size for the attachment chip. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
