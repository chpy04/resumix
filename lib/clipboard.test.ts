import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canCopy, copyText, type ClipboardEnv } from './clipboard.ts';

function env(writeText?: (text: string) => Promise<void>, isSecureContext = true): ClipboardEnv {
  return { isSecureContext, navigator: { clipboard: writeText ? { writeText } : {} } };
}

test('copies through the Clipboard API when it is there', async () => {
  const written: string[] = [];
  const result = await copyText(
    '/resumix-apply abc',
    env(async (text) => {
      written.push(text);
    }),
  );
  assert.equal(result, 'copied');
  assert.deepEqual(written, ['/resumix-apply abc']);
});

test('outside a secure context there is no API, so nothing is attempted', async () => {
  let called = false;
  const insecure = env(async () => {
    called = true;
  }, false);
  assert.equal(canCopy(insecure), false);
  assert.equal(await copyText('x', insecure), 'unavailable');
  assert.equal(called, false);
});

test('no navigator.clipboard, or no writeText, is unavailable', async () => {
  assert.equal(await copyText('x', { isSecureContext: true }), 'unavailable');
  assert.equal(await copyText('x', { isSecureContext: true, navigator: {} }), 'unavailable');
  assert.equal(await copyText('x', env()), 'unavailable');
});

test('a refused write is failed, which a fresh click may still fix', async () => {
  const refusing = env(async () => {
    throw new DOMException('Document is not focused.', 'NotAllowedError');
  });
  assert.equal(canCopy(refusing), true);
  assert.equal(await copyText('x', refusing), 'failed');
});
