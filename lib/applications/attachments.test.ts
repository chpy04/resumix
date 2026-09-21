import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAttachmentFilename, servableContentType } from './attachments.ts';

test('servableContentType passes through the types we are willing to name', () => {
  assert.equal(servableContentType('application/pdf'), 'application/pdf');
  assert.equal(servableContentType('image/png'), 'image/png');
  assert.equal(servableContentType('text/plain'), 'text/plain');
});

test('servableContentType downgrades anything else to an opaque download', () => {
  // The point: an uploaded .html must never come back as a live page on this
  // origin, where it would run with the session.
  assert.equal(servableContentType('text/html'), 'application/octet-stream');
  assert.equal(servableContentType('image/svg+xml'), 'application/octet-stream');
  assert.equal(servableContentType(''), 'application/octet-stream');
});

test('sanitizeAttachmentFilename flattens directory components', () => {
  assert.equal(sanitizeAttachmentFilename('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(sanitizeAttachmentFilename('C:\\docs\\cover.pdf'), 'C:_docs_cover.pdf');
});

test('sanitizeAttachmentFilename strips what would break a header', () => {
  assert.equal(sanitizeAttachmentFilename('cover".pdf'), 'cover.pdf');
  assert.equal(sanitizeAttachmentFilename('cover\r\n.pdf'), 'cover.pdf');
});

test('sanitizeAttachmentFilename never returns an empty name', () => {
  assert.equal(sanitizeAttachmentFilename('   '), 'attachment');
  assert.equal(sanitizeAttachmentFilename(''), 'attachment');
});

test('sanitizeAttachmentFilename bounds the length', () => {
  assert.equal(sanitizeAttachmentFilename('a'.repeat(500)).length, 200);
});
