// prod/ is production, run with plain `docker compose` from that folder
// (D-053). Nothing here starts a container or reaches a database: the token
// script runs against a stand-in `docker` that answers the way compose
// would, and everything else is read from git and the filesystem.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const COMPOSE = 'prod/docker-compose.yml';
const MINT = 'prod/mint-token';
const TOKEN = `rmx_${'A'.repeat(42)}w`;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function ignored(path: string): boolean {
  return spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0;
}

test('git ignores production secrets and backups, and keeps the backups folder', () => {
  for (const path of ['prod/.env', 'prod/backups/20260101-000000.sql']) {
    assert.ok(ignored(path), `${path} is not gitignored, so it could be committed`);
  }
  // Tracked, so the folder exists, owned by whoever cloned, before Docker
  // would create it as root for the bind mount.
  assert.equal(git('ls-files', 'prod/backups/.gitkeep').trim(), 'prod/backups/.gitkeep');
});

test('the Docker build context leaves prod/ out', () => {
  // The images build from the repo root, so without this `COPY . .` would
  // carry prod/.env and every backup into them.
  const lines = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n');
  assert.ok(lines.includes('prod'), '.dockerignore does not exclude prod/');
});

test('the compose project keeps the name that owns the production volume', () => {
  // Renaming the project would start production on a new, empty volume.
  const compose = readFileSync(join(ROOT, COMPOSE), 'utf8');
  assert.match(compose, /^name: resumix-prod$/m);
  // A profiled service is skipped by a plain `build`, which is how a stale
  // migrate image once came to run the migrations (D-053).
  assert.doesNotMatch(compose, /^\s*profiles:/m);
});

// mint-token, run from a throwaway copy of prod/ with a stand-in `docker`
// first on PATH. The environment is built from nothing, so CLAUDECODE, set
// in every Claude Code session, reaches the script only where a test sets it.
const scratch = mkdtempSync(join(tmpdir(), 'resumix-prod-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let copies = 0;
function prodCopy(env: string | null): string {
  const dir = join(scratch, `prod-${++copies}`);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  copyFileSync(join(ROOT, MINT), join(dir, 'mint-token'));
  if (env !== null) writeFileSync(join(dir, '.env'), env);
  // Records its arguments, then prints what token:create prints: the
  // secret alone on stdout, the notes on stderr.
  writeFileSync(
    join(dir, 'bin', 'docker'),
    `#!/bin/sh\nprintf '%s\\n' "$*" > "${join(dir, 'docker-args')}"\n` +
      `echo 'Created API token 1234 ("x") for owner@example.com.' >&2\necho '${TOKEN}'\n`,
    { mode: 0o755 },
  );
  return dir;
}

function mint(dir: string, args: string[] = [], extra: Record<string, string> = {}) {
  // Built from nothing on purpose; the app's ProcessEnv type requires a
  // NODE_ENV the script has no use for.
  const env: Record<string, string> = { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, ...extra };
  return spawnSync('bash', [join(dir, 'mint-token'), ...args], {
    cwd: scratch,
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
}

function dockerArgs(dir: string): string | null {
  const file = join(dir, 'docker-args');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

test('mint-token is tracked as executable', () => {
  assert.match(git('ls-files', '-s', MINT), /^100755 /, `${MINT} is not tracked with mode 100755`);
});

test('mint-token prints the token and the connect command built from PUBLIC_URL', () => {
  const dir = prodCopy(
    `OWNER_EMAIL=owner@example.com\nPUBLIC_URL="https://resumix.example.com/"\n`,
  );
  const result = mint(dir);
  assert.equal(result.status, 0, result.stderr);

  // Against production's database, through the migrate image, from prod/.
  assert.equal(
    dockerArgs(dir),
    'compose run --rm -T migrate npm run -s token:create -- --label laptop-agent',
  );
  assert.match(result.stdout, new RegExp(`^ {4}${TOKEN}$`, 'm'));
  // Quotes and the trailing slash are gone, so the line pastes as it is.
  assert.match(
    result.stdout,
    new RegExp(`^ {4}agent/connect\\.sh https://resumix\\.example\\.com/api/mcp ${TOKEN}$`, 'm'),
  );
});

test('mint-token passes a label through', () => {
  const dir = prodCopy('PUBLIC_URL=https://resumix.example.com\n');
  const result = mint(dir, ['phone-agent']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(dockerArgs(dir) ?? '', / --label phone-agent$/);
});

test('mint-token refuses a missing or unusable PUBLIC_URL before minting anything', () => {
  for (const env of [
    'OWNER_EMAIL=owner@example.com\n',
    'PUBLIC_URL=\n',
    'PUBLIC_URL=http://resumix.example.com\n',
    'PUBLIC_URL=https://resumix.example.com/app\n',
    'PUBLIC_URL=https://resumix.example.com;id\n',
  ]) {
    const dir = prodCopy(env);
    const result = mint(dir);
    assert.equal(result.status, 1, `accepted ${env.trim()}`);
    assert.match(result.stderr, /PUBLIC_URL/);
    assert.equal(dockerArgs(dir), null, `minted a token with ${env.trim()}`);
  }
});

test('mint-token refuses without prod/.env', () => {
  const dir = prodCopy(null);
  const result = mint(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prod\/\.env is missing/);
  assert.equal(dockerArgs(dir), null);
});

test('mint-token refuses to run under Claude Code', () => {
  const dir = prodCopy('PUBLIC_URL=https://resumix.example.com\n');
  const result = mint(dir, [], { CLAUDECODE: '1' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CLAUDECODE is set/);
  assert.equal(dockerArgs(dir), null);
  assert.doesNotMatch(result.stdout, /rmx_/);
});
