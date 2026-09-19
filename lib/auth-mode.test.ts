import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthMode, isDevAuth } from './auth-mode.ts';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('defaults to dev mode outside production', () => {
  const mode = withEnv({ RESUMIX_AUTH_MODE: undefined, NODE_ENV: 'development' }, getAuthMode);
  assert.equal(mode, 'dev');
});

test('defaults to password mode in production — auto-login can never ship by accident', () => {
  const mode = withEnv({ RESUMIX_AUTH_MODE: undefined, NODE_ENV: 'production' }, getAuthMode);
  assert.equal(mode, 'password');
});

test('an explicit mode always wins', () => {
  assert.equal(
    withEnv({ RESUMIX_AUTH_MODE: 'password', NODE_ENV: 'development' }, getAuthMode),
    'password',
  );
  assert.equal(
    withEnv({ RESUMIX_AUTH_MODE: 'supabase', NODE_ENV: 'development' }, getAuthMode),
    'supabase',
  );
  // Deliberately allowed: running dev auth in a production build is how you
  // demo the app locally against a production bundle.
  assert.equal(
    withEnv({ RESUMIX_AUTH_MODE: 'dev', NODE_ENV: 'production' }, getAuthMode),
    'dev',
  );
});

test('mode names are case- and whitespace-insensitive', () => {
  assert.equal(withEnv({ RESUMIX_AUTH_MODE: '  Password ' }, getAuthMode), 'password');
});

test('an unrecognised mode throws rather than falling back to something permissive', () => {
  assert.throws(
    () => withEnv({ RESUMIX_AUTH_MODE: 'none' }, getAuthMode),
    /not one of: dev, password, supabase/,
  );
});

test('isDevAuth tracks getAuthMode', () => {
  assert.equal(withEnv({ RESUMIX_AUTH_MODE: 'dev' }, isDevAuth), true);
  assert.equal(withEnv({ RESUMIX_AUTH_MODE: 'password' }, isDevAuth), false);
});
