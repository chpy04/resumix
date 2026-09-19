/**
 * Session resolution across all three auth modes (T14).
 *
 * These call `requireUser()` with real `Request` objects against a real
 * database — the same path a route handler takes — because the thing under
 * test is precisely how a request turns into a `users` row.
 *
 * Dev mode is covered here rather than in the browser suite: it needs its
 * own server process with a different `RESUMIX_AUTH_MODE`, and two
 * concurrent `next dev` servers cannot share a build directory (see
 * playwright.config.ts).
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const skip = !process.env.DATABASE_URL;

let mintToken: typeof import('./auth.ts').mintToken;
let requireUser: typeof import('./session.ts').requireUser;
let loginWithPassword: typeof import('./session.ts').loginWithPassword;
let UnauthorizedError: typeof import('./queries/errors.ts').UnauthorizedError;
let SupabaseAuthNotConfiguredError: typeof import('./auth-supabase.ts').SupabaseAuthNotConfiguredError;
let fixtures: typeof import('./queries/test-fixtures.ts');

if (!skip) {
  ({ mintToken } = await import('./auth.ts'));
  ({ loginWithPassword, requireUser } = await import('./session.ts'));
  ({ UnauthorizedError } = await import('./queries/errors.ts'));
  ({ SupabaseAuthNotConfiguredError } = await import('./auth-supabase.ts'));
  fixtures = await import('./queries/test-fixtures.ts');
}

after(async () => {
  if (!skip) await fixtures.closeTestDb();
});

const SECRET = 'session-test-secret';
const PASSWORD = 'session-test-password';

/**
 * Runs `fn` with `env` applied, restoring the previous values afterwards.
 *
 * Awaits the result *inside* the try: every function under test here is
 * async, and a synchronous `finally` would restore the environment the
 * instant `fn` returned its promise — before the code inside it had read
 * `process.env` past its first `await`. That fails in exactly one
 * direction, silently making "fails closed" assertions pass for the wrong
 * reason.
 */
async function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function request(token?: string): Request {
  return new Request('http://localhost/api/session', {
    headers: token ? { 'x-resumix-token': token } : {},
  });
}

// --------------------------------------------------------------- dev mode

test('dev mode resolves the seeded user with no token at all', { skip }, async () => {
  const expected = await fixtures.seedUserId();
  const user = await withEnv({ RESUMIX_AUTH_MODE: 'dev' }, () => requireUser(request()));
  assert.equal(user.id, expected);
  assert.ok(user.email.length > 0);
});

test('dev mode ignores whatever token happens to be lying around', { skip }, async () => {
  // A leftover token from a previous run in password mode must not change
  // who you are, or confuse the session into failing.
  const expected = await fixtures.seedUserId();
  const user = await withEnv({ RESUMIX_AUTH_MODE: 'dev' }, () =>
    requireUser(request('garbage.token')),
  );
  assert.equal(user.id, expected);
});

// ---------------------------------------------------------- password mode

test('password mode rejects a request with no token', { skip }, async () => {
  await assert.rejects(
    () =>
      withEnv({ RESUMIX_AUTH_MODE: 'password', AUTH_SECRET: SECRET }, () => requireUser(request())),
    UnauthorizedError,
  );
});

test('password mode resolves the user named by the token', { skip }, async () => {
  const user = await fixtures.insertUser(fixtures.testTag());
  const token = await mintToken(SECRET, user.id);

  const resolved = await withEnv({ RESUMIX_AUTH_MODE: 'password', AUTH_SECRET: SECRET }, () =>
    requireUser(request(token)),
  );
  assert.equal(resolved.id, user.id);
  assert.equal(resolved.email, user.email);
});

test(
  'password mode rejects a validly-signed token naming a user that does not exist',
  { skip },
  async () => {
    const token = await mintToken(SECRET, '00000000-0000-0000-0000-000000000000');
    await assert.rejects(
      () =>
        withEnv({ RESUMIX_AUTH_MODE: 'password', AUTH_SECRET: SECRET }, () =>
          requireUser(request(token)),
        ),
      UnauthorizedError,
    );
  },
);

test('password mode rejects a token signed with a different secret', { skip }, async () => {
  const user = await fixtures.insertUser(fixtures.testTag());
  const token = await mintToken('some-other-secret', user.id);
  await assert.rejects(
    () =>
      withEnv({ RESUMIX_AUTH_MODE: 'password', AUTH_SECRET: SECRET }, () =>
        requireUser(request(token)),
      ),
    UnauthorizedError,
  );
});

// ---------------------------------------------------------- supabase mode

test(
  'supabase mode fails closed — it never lets a request through unidentified',
  { skip },
  async () => {
    // Deliberately not an UnauthorizedError: this is a misconfigured server
    // (a mode was selected that nobody has implemented), not a caller who
    // failed to authenticate. It surfaces as a 500, loudly.
    await assert.rejects(
      () => withEnv({ RESUMIX_AUTH_MODE: 'supabase' }, () => requireUser(request('anything'))),
      SupabaseAuthNotConfiguredError,
    );
  },
);

// -------------------------------------------------------- loginWithPassword

test('loginWithPassword rejects the wrong password', { skip }, async () => {
  const token = await withEnv(
    { RESUMIX_AUTH_MODE: 'password', APP_PASSWORD: PASSWORD, AUTH_SECRET: SECRET },
    () => loginWithPassword('not-the-password'),
  );
  assert.equal(token, null);
});

test('loginWithPassword binds the token to OWNER_EMAIL', { skip }, async () => {
  const user = await fixtures.insertUser(fixtures.testTag());

  const token = await withEnv(
    {
      RESUMIX_AUTH_MODE: 'password',
      APP_PASSWORD: PASSWORD,
      AUTH_SECRET: SECRET,
      OWNER_EMAIL: user.email,
    },
    () => loginWithPassword(PASSWORD),
  );
  assert.ok(token);

  const resolved = await withEnv({ RESUMIX_AUTH_MODE: 'password', AUTH_SECRET: SECRET }, () =>
    requireUser(request(token!)),
  );
  assert.equal(resolved.id, user.id, 'the minted token must name exactly that account');
});

test('loginWithPassword matches OWNER_EMAIL case-insensitively', { skip }, async () => {
  const user = await fixtures.insertUser(fixtures.testTag());
  const token = await withEnv(
    {
      RESUMIX_AUTH_MODE: 'password',
      APP_PASSWORD: PASSWORD,
      AUTH_SECRET: SECRET,
      OWNER_EMAIL: user.email.toUpperCase(),
    },
    () => loginWithPassword(PASSWORD),
  );
  assert.ok(token, 'Email addresses are case-insensitive identities');
});

test('loginWithPassword refuses an OWNER_EMAIL that matches nobody', { skip }, async () => {
  const token = await withEnv(
    {
      RESUMIX_AUTH_MODE: 'password',
      APP_PASSWORD: PASSWORD,
      AUTH_SECRET: SECRET,
      OWNER_EMAIL: 'nobody-here@example.test',
    },
    () => loginWithPassword(PASSWORD),
  );
  assert.equal(token, null, 'better to fail the login than to guess an account');
});

test(
  'loginWithPassword refuses to guess when several users exist and OWNER_EMAIL is unset',
  { skip },
  async () => {
    // One shared password cannot distinguish between people. Handing out
    // somebody's account because they happened to sort first would be worse
    // than refusing.
    await fixtures.insertUser(fixtures.testTag());
    await fixtures.insertUser(fixtures.testTag());

    const token = await withEnv(
      {
        RESUMIX_AUTH_MODE: 'password',
        APP_PASSWORD: PASSWORD,
        AUTH_SECRET: SECRET,
        OWNER_EMAIL: undefined,
      },
      () => loginWithPassword(PASSWORD),
    );
    assert.equal(token, null);
  },
);
