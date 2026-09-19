import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeUserAgent } from './user-agent.ts';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';

test('the common desktop browsers are named with their major version and OS', () => {
  assert.equal(describeUserAgent(CHROME_MAC), 'Chrome 142 on macOS');
  assert.equal(describeUserAgent(SAFARI_MAC), 'Safari 18 on macOS');
  assert.equal(describeUserAgent(FIREFOX_LINUX), 'Firefox 133 on Linux');
});

test('a Chromium browser is not reported as Chrome, and Chrome is not reported as Safari', () => {
  // Both of these UA strings contain the word `Chrome`; only one is Chrome.
  assert.equal(describeUserAgent(EDGE_WINDOWS), 'Edge 142 on Windows');
  assert.ok(!describeUserAgent(CHROME_MAC).startsWith('Safari'));
});

test('a mobile UA reports the phone OS, not the Linux or Mac it claims underneath', () => {
  assert.equal(describeUserAgent(SAFARI_IPHONE), 'Safari 18 on iOS');
  assert.equal(describeUserAgent(CHROME_ANDROID), 'Chrome 142 on Android');
});

test('an unrecognisable or missing user agent degrades instead of throwing', () => {
  assert.equal(describeUserAgent(null), 'unknown');
  assert.equal(describeUserAgent(undefined), 'unknown');
  assert.equal(describeUserAgent('   '), 'unknown');
  assert.equal(describeUserAgent('curl/8.7.1'), 'unknown');
  // The platform alone is still worth saying when the browser is unknown.
  assert.equal(describeUserAgent('SomeBot/1.0 (Windows NT 10.0)'), 'Windows');
});
