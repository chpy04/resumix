import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64PdfToObjectUrl } from './pdf-blob.ts';

test('base64PdfToObjectUrl decodes bytes faithfully into a blob: URL', async () => {
  const original = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]); // "%PDF" + junk
  const base64 = Buffer.from(original).toString('base64');

  const url = base64PdfToObjectUrl(base64);
  assert.match(url, /^blob:/);

  const response = await fetch(url);
  const roundTripped = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Array.from(roundTripped), Array.from(original));
  assert.equal(response.headers.get('content-type'), 'application/pdf');

  URL.revokeObjectURL(url);
});
