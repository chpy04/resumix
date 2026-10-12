// Two Claudes work in this repo. The one in agent/ applies to jobs, and every
// Resumix MCP call it makes goes to production; the one at the root builds
// Resumix and must never have that server at all. So agent/.mcp.json is the
// only file allowed to configure it (D-038), and this is that rule as a test.
// Pure: it reads git and the filesystem, never the database.
//
// It cannot see `claude mcp add`, which writes to ~/.claude.json, outside the
// repo. CLAUDE.md says not to use it for Resumix.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** The files Claude Code reads MCP servers, or permissions for their tools, from. */
const MCP_CONFIG_FILE = /(?:^|\/)(?:\.mcp\.json|\.claude\/settings[^/]*\.json)$/;

/** A server name or an enabled-server entry: any mention of Resumix counts. */
const RESUMIX_SERVER_NAME = /resumix/i;

/**
 * Anywhere else, only what is unmistakably the Resumix MCP: agent/.env's
 * variable names, the endpoint (dev's included, since no Resumix MCP belongs
 * at the root at all), an `rmx_` token, or a permission for one of its tools.
 * A bare "resumix" is not enough: the root deny list names `~/.resumix`.
 */
const RESUMIX_MCP_STRING = /RESUMIX_MCP_|\/api\/mcp\b|\brmx_\w|mcp__resumix/;

/** Every place in a parsed config that points a session at Resumix's MCP. */
function resumixMcpFindings(config: unknown, at = '$'): string[] {
  if (typeof config === 'string') {
    return RESUMIX_MCP_STRING.test(config) ? [`${at}: ${config}`] : [];
  }
  if (Array.isArray(config)) {
    return config.flatMap((item, i) => resumixMcpFindings(item, `${at}[${i}]`));
  }
  if (config === null || typeof config !== 'object') return [];

  const findings: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    const path = `${at}.${key}`;
    if (key === 'mcpServers' && value !== null && typeof value === 'object') {
      for (const name of Object.keys(value)) {
        if (RESUMIX_SERVER_NAME.test(name)) findings.push(`${path}.${name}`);
      }
    }
    if (key === 'enabledMcpjsonServers' && Array.isArray(value)) {
      for (const name of value) {
        if (typeof name === 'string' && RESUMIX_SERVER_NAME.test(name)) {
          findings.push(`${path}: ${name}`);
        }
      }
    }
    if (RESUMIX_MCP_STRING.test(key)) findings.push(path);
    findings.push(...resumixMcpFindings(value, path));
  }
  return findings;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
}

/** Tracked and untracked-but-not-ignored MCP config files, outside agent/. */
function mcpConfigFilesOutsideAgent(): string[] {
  const files = new Set(
    git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
      .split('\0')
      .filter((file) => MCP_CONFIG_FILE.test(file) && !file.startsWith('agent/'))
      .filter((file) => existsSync(join(ROOT, file))),
  );
  // Gitignored, so git never lists it, yet Claude Code loads it over
  // settings.json, in a root session and in one started in agent/ alike. It
  // exists only on a machine someone works on, never in CI or a worktree.
  if (existsSync(join(ROOT, '.claude/settings.local.json'))) {
    files.add('.claude/settings.local.json');
  }
  return [...files];
}

interface McpJson {
  mcpServers: Record<string, { args?: string[] } | undefined>;
}

test('no file outside agent/ configures the Resumix MCP', () => {
  const files = mcpConfigFilesOutsideAgent();
  // Without this, a scan that matched nothing would pass vacuously.
  assert.ok(files.includes('.claude/settings.json'), `the scan missed .claude/settings.json`);

  for (const file of files) {
    assert.deepEqual(
      resumixMcpFindings(readJson(file)),
      [],
      `${file} configures the Resumix MCP. Only agent/.mcp.json may (D-038).`,
    );
  }
});

test('the guard flags the real agent/.mcp.json', () => {
  assert.notDeepEqual(resumixMcpFindings(readJson('agent/.mcp.json')), []);
});

test('the guard passes config that does not reach Resumix', () => {
  const supabase = {
    mcpServers: { supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp?features=docs' } },
  };
  assert.deepEqual(resumixMcpFindings(supabase), []);
  assert.deepEqual(resumixMcpFindings({ permissions: { deny: ['Read(~/.resumix/**)'] } }), []);
});

test('the guard flags a Resumix endpoint under any name, the dev server included', () => {
  const dev = { mcpServers: { local: { type: 'http', url: 'http://localhost:3000/api/mcp' } } };
  assert.notDeepEqual(resumixMcpFindings(dev), []);
});

test('agent/.mcp.json takes the Resumix URL and token from agent/.env, unfilled', () => {
  const { mcpServers } = readJson('agent/.mcp.json') as McpJson;
  assert.deepEqual(mcpServers.resumix, {
    type: 'http',
    url: '${RESUMIX_MCP_URL}',
    headers: { Authorization: 'Bearer ${RESUMIX_MCP_TOKEN}' },
  });
});

test('Playwright MCP runs headed, with the persistent browser profile', () => {
  const { mcpServers } = readJson('agent/.mcp.json') as McpJson;
  const args = mcpServers.playwright?.args ?? [];

  assert.ok(args.includes('--user-data-dir'), 'no --user-data-dir: logins would not persist');
  const profile = args[args.indexOf('--user-data-dir') + 1];
  assert.match(profile ?? '', /(?:^|\/)\.browser-profile$/);

  // Headed is the default. --headless hides the browser Chris watches fill in
  // a real form, and --isolated keeps the profile in memory, so the ATS logins
  // would be gone by the next session.
  for (const flag of ['--headless', '--isolated']) {
    assert.ok(!args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)), `${flag} is set`);
  }
});

test('git ignores the secrets and personal data agent/ holds', () => {
  for (const path of ['agent/.env', 'agent/.browser-profile/x', 'agent/career-ops-data/x']) {
    const { status } = spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT });
    assert.equal(status, 0, `${path} is not gitignored, so it could be committed`);
  }
});

test('career-ops is a pinned submodule, not vendored files', () => {
  assert.match(
    git('ls-files', '-s', 'agent/career-ops'),
    /^160000 [0-9a-f]{40} 0\tagent\/career-ops\n$/,
  );
});
