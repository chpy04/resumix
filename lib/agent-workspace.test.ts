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

/** The root's per-machine settings, the one file that may record approvals. */
const LOCAL_SETTINGS = '.claude/settings.local.json';

/** A server name or an enabled-server entry: any mention of Resumix counts. */
const RESUMIX_SERVER_NAME = /resumix/i;

/**
 * Anywhere else, only what is unmistakably the Resumix MCP: agent/.env's
 * variable names, the endpoint (dev's included, since no Resumix MCP belongs
 * at the root at all), or an `rmx_` token. A bare "resumix" is not enough: it
 * is also the repo's name, so ordinary paths and permissions contain it.
 */
const RESUMIX_MCP_STRING = /RESUMIX_MCP_|\/api\/mcp\b|\brmx_\w/;

/** A permission for one of the Resumix MCP's tools (`mcp__resumix__get_library`). */
const RESUMIX_TOOL_PERMISSION = /mcp__resumix/;

interface FindingOptions {
  /**
   * Check only what can connect: `mcpServers` definitions, for a resumix name
   * or the endpoint, token or variables anywhere inside one. Approval lists
   * and permission rules pass whatever they say. Only the root
   * settings.local.json gets this; see mcpConfigFilesOutsideAgent.
   */
  approvalsAllowed?: boolean;
}

/** Every place in a parsed config that points a session at Resumix's MCP. */
function resumixMcpFindings(config: unknown, { approvalsAllowed = false }: FindingOptions = {}) {
  const flagged = (text: string) =>
    RESUMIX_MCP_STRING.test(text) || (!approvalsAllowed && RESUMIX_TOOL_PERMISSION.test(text));

  // `checked` is false only in the relaxed mode, outside every definition.
  const walk = (node: unknown, at: string, checked: boolean): string[] => {
    if (typeof node === 'string') return checked && flagged(node) ? [`${at}: ${node}`] : [];
    if (Array.isArray(node)) return node.flatMap((item, i) => walk(item, `${at}[${i}]`, checked));
    if (node === null || typeof node !== 'object') return [];

    const findings: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      const path = `${at}.${key}`;
      // A definition is flagged everywhere: it is what actually connects.
      const definitions = key === 'mcpServers' && value !== null && typeof value === 'object';
      if (definitions) {
        for (const name of Object.keys(value)) {
          if (RESUMIX_SERVER_NAME.test(name)) findings.push(`${path}.${name}`);
        }
      }
      if (key === 'enabledMcpjsonServers' && Array.isArray(value) && !approvalsAllowed) {
        for (const name of value) {
          if (typeof name === 'string' && RESUMIX_SERVER_NAME.test(name)) {
            findings.push(`${path}: ${name}`);
          }
        }
      }
      if (checked && flagged(key)) findings.push(path);
      findings.push(...walk(value, path, checked || definitions));
    }
    return findings;
  };
  return walk(config, '$', !approvalsAllowed);
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
  //
  // It is also where Claude Code writes what Chris approves, from agent/ and
  // the root alike: the server name in enabledMcpjsonServers, `mcp__resumix__*`
  // permissions, and Bash rules such as a dev `curl` of /api/mcp while he works
  // on the server. None of that connects anything at the root, which has no
  // `resumix` definition to switch on (the scan of the root .mcp.json makes
  // sure of that), so in this file alone only server definitions are checked.
  if (existsSync(join(ROOT, LOCAL_SETTINGS))) {
    files.add(LOCAL_SETTINGS);
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
      resumixMcpFindings(readJson(file), { approvalsAllowed: file === LOCAL_SETTINGS }),
      [],
      `${file} configures the Resumix MCP. Only agent/.mcp.json may (D-038).`,
    );
  }
});

// The positive controls run in both modes: relaxing the root settings.local.json
// for approvals must not let a real definition through there either.
const MODES: FindingOptions[] = [{ approvalsAllowed: false }, { approvalsAllowed: true }];

test('the guard flags the real agent/.mcp.json', () => {
  for (const mode of MODES) {
    assert.notDeepEqual(resumixMcpFindings(readJson('agent/.mcp.json'), mode), []);
  }
});

test('the guard passes config that does not reach Resumix', () => {
  const supabase = {
    mcpServers: { supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp?features=docs' } },
  };
  assert.deepEqual(resumixMcpFindings(supabase), []);
  assert.deepEqual(resumixMcpFindings({ permissions: { deny: ['Read(~/resumix/.env)'] } }), []);
});

test('the guard flags a Resumix endpoint under any name, the dev server included', () => {
  const dev = { mcpServers: { local: { type: 'http', url: 'http://localhost:3000/api/mcp' } } };
  for (const mode of MODES) {
    assert.notDeepEqual(resumixMcpFindings(dev, mode), []);
  }
});

test('approving the server is allowed in the root settings.local.json only', () => {
  // What a session in agent/ writes to the root file when Chris approves
  // resumix and ticks "don't ask again" on one of its tools.
  const approvals = {
    enabledMcpjsonServers: ['supabase', 'resumix'],
    permissions: { allow: ['mcp__resumix__get_library'] },
  };
  assert.deepEqual(resumixMcpFindings(approvals, { approvalsAllowed: true }), []);
  assert.notDeepEqual(resumixMcpFindings(approvals), []);

  // What a root session writes when he allows a dev curl while building the server.
  const devCurl = { permissions: { allow: ['Bash(curl -s http://localhost:3000/api/mcp:*)'] } };
  assert.deepEqual(resumixMcpFindings(devCurl, { approvalsAllowed: true }), []);
  assert.notDeepEqual(resumixMcpFindings(devCurl), []);

  // A definition is still a definition there.
  const devServer = {
    mcpServers: { local: { type: 'http', url: 'http://localhost:3000/api/mcp' } },
  };
  assert.notDeepEqual(resumixMcpFindings(devServer, { approvalsAllowed: true }), []);
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
