// The applying Claude's skills, checked the only way anything in agent/ is:
// statically (C8). No Claude that builds Resumix ever runs one, so a skill
// naming a tool `/api/mcp` does not serve, or a routing block the installer
// cannot parse, would otherwise first fail in production, in front of Chris.
// Pure: git, the filesystem and bash, never the database or the network.
// The conventions it enforces are in .claude/rules/agent-skills.md.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
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
import { TOOLS } from './mcp/tools/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RULES = 'See .claude/rules/agent-skills.md.';
const SKILLS_DIR = 'agent/.claude/skills/';
const PROPOSE = `${SKILLS_DIR}resumix-propose/SKILL.md`;
const ROUTING = 'agent/career-ops-custom.md';
const INSTALLER = 'agent/install-career-ops-custom.sh';
const EVAL = 'agent/evals/propose.md';

const BEGIN = '<!-- resumix-routing:begin';
const END = '<!-- resumix-routing:end';

/** What `tools/list` serves: the registry is the list. */
const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/** The name the model sees for a Resumix tool, and so the one a skill writes. */
const QUALIFIED_TOOL = /\bmcp__resumix__([a-z0-9_]+)/g;

/**
 * A code span opening on a snake_case name with a tool's verb, such as
 * `suggest_bullet`: a tool, as far as a reader of the skill can tell. Names
 * in TOOLS are caught as bare anyway; this catches the ones not in it.
 */
const TOOL_LIKE =
  /`((?:get|set|list|create|update|delete|add|suggest|submit|mark|report)_[a-z0-9_]+)\b/g;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8');
}

/**
 * Tracked and untracked-but-not-ignored regular files under agent/. The
 * career-ops submodule is a gitlink, not a file, so it drops out here: what
 * it says is upstream's, not ours.
 */
function agentFiles(): string[] {
  return git('ls-files', '-z', '--cached', '--others', '--exclude-standard', 'agent/')
    .split('\0')
    .filter((file) => file !== '')
    .filter((file) => {
      try {
        return lstatSync(join(ROOT, file)).isFile();
      } catch {
        return false; // deleted in the working tree
      }
    });
}

function skillFiles(): string[] {
  return agentFiles().filter((f) => f.startsWith(SKILLS_DIR) && f.endsWith('/SKILL.md'));
}

/**
 * The frontmatter, one `key: value` line at a time. Skills keep every key on
 * one line for exactly this reason: no YAML parser is a dependency here.
 */
function frontmatter(text: string): Map<string, string> {
  const lines = text.split('\n');
  assert.equal(lines[0], '---', `a skill must open with --- frontmatter. ${RULES}`);
  const close = lines.indexOf('---', 1);
  assert.ok(close > 0, `the frontmatter is never closed with ---. ${RULES}`);

  const keys = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    const match = /^([a-z][a-z-]*): (.+)$/.exec(line);
    assert.ok(match, `frontmatter line "${line}" is not one key: value line. ${RULES}`);
    const [, key = '', value = ''] = match;
    keys.set(key, value.replace(/^"(.*)"$/, '$1').trim());
  }
  return keys;
}

/** Lines that start with a marker. The begin line carries its own comment after it. */
function markerLines(text: string, marker: string): number[] {
  return text.split('\n').flatMap((line, i) => (line.startsWith(marker) ? [i] : []));
}

test('every Resumix tool named in agent/ is one tools/list serves', () => {
  const files = agentFiles();
  // Without these, a scan that matched nothing would pass vacuously.
  for (const file of [PROPOSE, ROUTING, INSTALLER, EVAL]) {
    assert.ok(files.includes(file), `the scan missed ${file}`);
  }

  let seen = 0;
  for (const file of files) {
    for (const [, name = ''] of read(file).matchAll(QUALIFIED_TOOL)) {
      seen++;
      assert.ok(
        TOOL_NAMES.has(name),
        `${file} names mcp__resumix__${name}, which is not in TOOLS (lib/mcp/tools/index.ts). ${RULES}`,
      );
    }
  }
  assert.ok(seen > 0, 'no mcp__resumix__ name found anywhere in agent/');
});

test('a skill writes Resumix tools fully qualified, never bare', () => {
  const skills = skillFiles();
  assert.ok(skills.includes(PROPOSE), `the scan missed ${PROPOSE}`);

  for (const file of skills) {
    const text = read(file);
    for (const name of TOOL_NAMES) {
      // `_` is a word character, so mcp__resumix__<name> never matches here.
      const bare = new RegExp(`\\b${name}\\b`).exec(text);
      assert.equal(
        bare,
        null,
        `${file} names ${name} bare; write mcp__resumix__${name}, the name the model sees. ${RULES}`,
      );
    }
    for (const [, name = ''] of text.matchAll(TOOL_LIKE)) {
      assert.ok(
        TOOL_NAMES.has(name),
        `${file} names \`${name}\`, which reads as a Resumix tool but is not in TOOLS. Land the ` +
          `tool first, or reword it. ${RULES}`,
      );
    }
  }
});

test('every skill has a name matching its directory and a description', () => {
  for (const file of skillFiles()) {
    const keys = frontmatter(read(file));
    const dir = file.slice(SKILLS_DIR.length, -'/SKILL.md'.length);
    assert.equal(keys.get('name'), dir, `${file}: name must be its directory. ${RULES}`);
    assert.ok((keys.get('description') ?? '').length > 0, `${file}: no description. ${RULES}`);
    // A production write happens only when Chris approves the call (D-038).
    assert.doesNotMatch(
      keys.get('allowed-tools') ?? '',
      /mcp__resumix/,
      `${file} pre-approves a Resumix tool. ${RULES}`,
    );
  }
});

test('resumix-propose runs only when typed, and takes the ticket path through Resumix', () => {
  const text = read(PROPOSE);
  const keys = frontmatter(text);
  assert.equal(keys.get('disable-model-invocation'), 'true');
  // Its argument is a pasted posting, which named arguments would split on
  // whitespace; the body reads $ARGUMENTS whole.
  assert.ok(!keys.has('arguments'), 'named arguments would split a pasted posting');
  assert.match(text, /\$ARGUMENTS/);

  for (const tool of [
    'ping',
    'list_applications',
    'create_application',
    'get_library',
    'set_resume_selection',
    // Its only way to propose text, which Chris applies or rejects (D-045).
    'suggest_bullet',
  ]) {
    assert.ok(text.includes(`mcp__resumix__${tool}`), `resumix-propose never calls ${tool}`);
  }
});

test('the installer is tracked as executable, and both ways in run it', () => {
  // Git records the mode; a 100644 file would fail ./claude.sh at launch.
  assert.match(
    git('ls-files', '-s', INSTALLER),
    /^100755 /,
    `${INSTALLER} is not tracked with mode 100755. ${RULES}`,
  );
  assert.match(read('agent/claude.sh'), /^\.\/install-career-ops-custom\.sh$/m);
  assert.ok(read(PROPOSE).includes('./install-career-ops-custom.sh'), 'the skill never runs it');
});

test('the routing file is one marked block', () => {
  const text = read(ROUTING);
  const begins = markerLines(text, BEGIN);
  const ends = markerLines(text, END);
  assert.equal(begins.length, 1, `${ROUTING} needs exactly one begin marker. ${RULES}`);
  assert.equal(ends.length, 1, `${ROUTING} needs exactly one end marker. ${RULES}`);
  const [begin = -1] = begins;
  const [end = -1] = ends;
  assert.ok(begin < end, `${ROUTING}: the begin marker must come first. ${RULES}`);
});

test('the eval has three cases, each a posting and a checklist', () => {
  const cases = read(EVAL)
    .split(/^## Case /m)
    .slice(1);
  assert.equal(cases.length, 3, `${EVAL} must hold three "## Case" sections. ${RULES}`);
  for (const section of cases) {
    const title = section.split('\n', 1)[0];
    assert.match(section, /^```/m, `case "${title}" has no fenced posting`);
    assert.match(section, /^- \[ \] /m, `case "${title}" has no "- [ ]" checklist`);
  }
});

// The installer, run the way claude.sh runs it, against a throwaway data
// directory. CAREER_OPS_DATA_DIR is always this test's own or absent, never
// inherited, so a real one in the calling shell can never be written to; the
// same goes for career-ops' two overrides of it.
const scratch = mkdtempSync(join(tmpdir(), 'resumix-agent-skills-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let dirs = 0;
function dataDir(): string {
  return join(scratch, `data-${++dirs}`);
}

function install(dataDirValue: string | undefined, extra: Record<string, string> = {}) {
  const env = { ...process.env };
  delete env.CAREER_OPS_DATA_DIR;
  delete env.CAREER_OPS_ROOT;
  delete env.CAREER_OPS_TRACKER;
  if (dataDirValue !== undefined) env.CAREER_OPS_DATA_DIR = dataDirValue;
  Object.assign(env, extra);
  return spawnSync('bash', [join(ROOT, INSTALLER)], { cwd: scratch, env, encoding: 'utf8' });
}

function customFile(dir: string): string {
  return join(dir, 'modes', '_custom.md');
}

/** Chris's own _custom.md, before the installer touches it. */
function seedCustom(dir: string, text: string): void {
  mkdirSync(join(dir, 'modes'), { recursive: true });
  writeFileSync(customFile(dir), text);
}

const block = read(ROUTING);

test('the installer creates _custom.md from the block, then leaves it alone', () => {
  const dir = dataDir();

  const first = install(dir);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, `installed: ${customFile(dir)}\n`);
  assert.equal(readFileSync(customFile(dir), 'utf8'), block);

  const second = install(dir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, `current: ${customFile(dir)}\n`);
  assert.equal(readFileSync(customFile(dir), 'utf8'), block);
});

test("the installer appends to Chris's file, and keeps every byte of it", () => {
  const dir = dataDir();
  const mine = '# My house rules\n\n- Always use British English.';
  seedCustom(dir, mine);

  const result = install(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(customFile(dir), 'utf8'), `${mine}\n\n${block}`);

  assert.equal(install(dir).stdout, `current: ${customFile(dir)}\n`);
});

test('the installer replaces an old block in place, and nothing around it', () => {
  const dir = dataDir();
  const before = '# My house rules\n\n- Reports lead with the score.\n\n';
  const rest = '\n## Off-Limits\n\n- Never submit for me.'; // no final newline, kept as is
  const old = `${BEGIN} an older version -->\n- An old rule.\n${END} -->\n`;
  seedCustom(dir, before + old + rest);

  const result = install(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `installed: ${customFile(dir)}\n`);
  assert.equal(readFileSync(customFile(dir), 'utf8'), before + block + rest);
});

test('the installer refuses an unset or relative CAREER_OPS_DATA_DIR', () => {
  for (const value of [undefined, '', 'career-ops-data']) {
    const result = install(value);
    assert.notEqual(result.status, 0, `ran with CAREER_OPS_DATA_DIR=${value}`);
    assert.match(result.stderr, /start the session with \.\/claude\.sh/i);
    assert.equal(result.stdout, '');
  }
});

test('the installer refuses a CAREER_OPS_ROOT that career-ops would read instead', () => {
  const dir = dataDir();
  const elsewhere = dataDir();

  const result = install(dir, { CAREER_OPS_ROOT: elsewhere });
  assert.notEqual(result.status, 0, 'installed with CAREER_OPS_ROOT pointing elsewhere');
  assert.match(result.stderr, /Remove CAREER_OPS_ROOT from agent\/\.env/);
  assert.equal(result.stdout, '');
  assert.ok(!existsSync(dir) && !existsSync(elsewhere), 'it wrote something before refusing');

  // The same directory, or a blank value, which career-ops ignores, is fine.
  for (const root of [dir, ' ']) {
    const same = install(dir, { CAREER_OPS_ROOT: root });
    assert.equal(same.status, 0, same.stderr);
  }
});

test('the installer refuses a begin marker with no end, and writes nothing', () => {
  const dir = dataDir();
  const broken = `- Mine.\n${BEGIN} -->\n- Half a block.\n`;
  seedCustom(dir, broken);

  const result = install(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Nothing was written/);
  assert.equal(readFileSync(customFile(dir), 'utf8'), broken);
});
