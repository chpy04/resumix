// The applying Claude's skills, checked the only way anything in agent/ is:
// statically (C8). No Claude that builds Resumix ever runs one, so a skill
// naming a tool `/api/mcp` does not serve, or a routing block the installer
// cannot parse, would otherwise first fail in production, in front of Chris.
// Pure: git, the filesystem and bash, never the database or a remote host;
// the download script's tests talk to a server of their own on 127.0.0.1.
// The conventions it enforces are in .claude/rules/agent-skills.md.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
const FETCHER = 'agent/fetch-apply-files.sh';
const APPLY = `${SKILLS_DIR}resumix-apply/SKILL.md`;
const APPLY_READY = `${SKILLS_DIR}resumix-apply-ready/SKILL.md`;
const APPLY_EVAL = 'agent/evals/apply.md';

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

/**
 * The tools `@playwright/mcp@0.0.83` serves by default, core automation plus
 * tabs, from its README. Any other name needs a `--caps` flag that
 * agent/.mcp.json does not pass, so a skill naming one would name nothing.
 * The version test below makes a bump re-check this list.
 */
const PLAYWRIGHT_VERSION = '@playwright/mcp@0.0.83';
const PLAYWRIGHT_TOOLS = new Set([
  'browser_click',
  'browser_close',
  'browser_console_messages',
  'browser_drag',
  'browser_drop',
  'browser_emulate_media',
  'browser_evaluate',
  'browser_file_upload',
  'browser_fill_form',
  'browser_find',
  'browser_handle_dialog',
  'browser_hover',
  'browser_navigate',
  'browser_navigate_back',
  'browser_network_request',
  'browser_network_requests',
  'browser_press_key',
  'browser_resize',
  'browser_run_code_unsafe',
  'browser_select_option',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_type',
  'browser_wait_for',
  'browser_tabs',
]);

const QUALIFIED_PLAYWRIGHT = /\bmcp__playwright__([a-z0-9_]+)/g;

/** `_` is a word character, so the qualified form never matches here. */
const BARE_PLAYWRIGHT = /\bbrowser_[a-z0-9_]+/g;

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

/** A `## ` section, from its heading to the next one, or null when it is missing. */
function section(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines.slice(start, next < 0 ? undefined : next).join('\n');
}

/** A top-level `- ` bullet, through its wrapped lines, or null when none starts so. */
function bullet(text: string, opening: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(opening));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && !line.startsWith(' '));
  return lines.slice(start, next < 0 ? undefined : next).join('\n');
}

test('every Resumix tool named in agent/ is one tools/list serves', () => {
  const files = agentFiles();
  // Without these, a scan that matched nothing would pass vacuously.
  for (const file of [PROPOSE, ROUTING, INSTALLER, EVAL, APPLY, APPLY_READY, FETCHER, APPLY_EVAL]) {
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
  for (const skill of [PROPOSE, APPLY, APPLY_READY]) {
    assert.ok(skills.includes(skill), `the scan missed ${skill}`);
  }

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
    'get_saved_answers',
    'add_questions',
    'get_application',
    'get_library',
    'set_resume_selection',
    'set_cover_letter_body',
    'submit_for_review',
    // Its only way to propose text, which Chris applies or rejects (D-045).
    'suggest_bullet',
  ]) {
    assert.ok(text.includes(`mcp__resumix__${tool}`), `resumix-propose never calls ${tool}`);
  }
  // Linking is the only way a saved answer reaches a form (D-048).
  assert.ok(text.includes('`saved_answer_id`'), 'resumix-propose never links a saved answer');
});

test('resumix-propose discovers the form after creating, and submits for review last', () => {
  const lines = read(PROPOSE).split('\n');
  const order = [
    '## 3. Track it in Resumix',
    '## 4. Discover the form',
    '## 5. Choose the resume',
    '## 6. Cover letter',
    '## 7. Submit for review',
    '## 8. Report',
  ];
  let previous = -1;
  for (const heading of order) {
    const at = lines.findIndex((line) => line.startsWith(heading));
    assert.ok(at >= 0, `${PROPOSE} has no "${heading}" step. ${RULES}`);
    assert.ok(at > previous, `${PROPOSE}: "${heading}" is out of order. ${RULES}`);
    previous = at;
  }
});

// These pin the rule against deletion; they cannot prove the behaviour, which
// only eval Case 4 does, by hand.
test('resumix-propose never submits a form, and bans the tools that could in code', () => {
  const rules = section(read(PROPOSE), '## Hard rules');
  assert.ok(rules, `${PROPOSE} has no "## Hard rules" section`);
  const found = bullet(rules, '- **Never submit');
  assert.ok(found, `${PROPOSE}'s hard rules have no "**Never submit" rule. ${RULES}`);
  // One line, so a ban may wrap anywhere; `[^.]*` keeps each one sentence.
  const never = found.replace(/\s+/g, ' ');
  for (const [ban, pattern] of [
    ['clicking Submit', /\bclick\b[^.]*"Submit"/],
    ['pressing Enter', /\bEnter\b[^.]*`mcp__playwright__browser_press_key`/],
    ['typing with submit set', /`submit`[^.]*`mcp__playwright__browser_type`/],
    ['browser_evaluate, which can submit in code', /`mcp__playwright__browser_evaluate`/],
    ['browser_run_code_unsafe, which can too', /`mcp__playwright__browser_run_code_unsafe`/],
  ] as const) {
    assert.match(never, pattern, `the never-submit rule no longer bans ${ban}. ${RULES}`);
  }

  for (const file of skillFiles()) {
    assert.doesNotMatch(
      read(file),
      /"?submit"?\s*:\s*true/,
      `${file} sets submit: true, which presses Enter after typing. ${RULES}`,
    );
  }
});

test('the apply skills carry the never-submit rule byte for byte', () => {
  // One rule, so the propose skill's checks above pin it for all three:
  // a skill that reworded it could weaken a ban without failing them.
  const rule = (file: string) => {
    const rules = section(read(file), '## Hard rules');
    assert.ok(rules, `${file} has no "## Hard rules" section. ${RULES}`);
    return bullet(rules, '- **Never submit');
  };
  const propose = rule(PROPOSE);
  assert.ok(propose);
  for (const file of [APPLY, APPLY_READY]) {
    assert.equal(
      rule(file),
      propose,
      `${file}'s "**Never submit" rule is not ${PROPOSE}'s, byte for byte. ${RULES}`,
    );
  }
});

test('resumix-apply runs only when typed, and fills from the packet', () => {
  const text = read(APPLY);
  const keys = frontmatter(text);
  assert.equal(keys.get('disable-model-invocation'), 'true');
  assert.ok(!keys.has('arguments'), 'it reads one id from $ARGUMENTS whole');
  assert.match(text, /\$ARGUMENTS/);
  for (const tool of ['ping', 'get_apply_packet', 'report_question', 'mark_applied']) {
    assert.ok(text.includes(`mcp__resumix__${tool}`), `resumix-apply never calls ${tool}`);
  }

  const lines = text.split('\n');
  const order = [
    '## 0. Check the connection',
    '## 1. Fetch the packet',
    '## 2. Download the files',
    '## 3. Open the form',
    '## 4. Fill each page',
    '## 5. Stop before Submit',
    '## 6. Mark it applied',
    '## 7. Report',
  ];
  let previous = -1;
  for (const heading of order) {
    const at = lines.findIndex((line) => line.startsWith(heading));
    assert.ok(at >= 0, `${APPLY} has no "${heading}" step. ${RULES}`);
    assert.ok(at > previous, `${APPLY}: "${heading}" is out of order. ${RULES}`);
    previous = at;
  }

  assert.ok(
    section(text, '## 2. Download the files')?.includes('./fetch-apply-files.sh'),
    'step 2 never runs the download script',
  );
  // Only Chris's "submitted" leads to it, and that comes after the stop.
  assert.ok(
    text.indexOf('mcp__resumix__mark_applied') > text.indexOf('## 5. Stop before Submit'),
    `${APPLY} names mark_applied before it stops before Submit. ${RULES}`,
  );
  assert.ok(
    section(text, "## A field the packet doesn't have")?.includes('mcp__resumix__report_question'),
    'an unseen field is never reported',
  );
  // Discovery's placeholders may sit in a saved draft: the fill step must
  // overwrite the approved and clear the rest.
  const fill = section(text, '## 4. Fill each page') ?? '';
  assert.match(fill, /overwriting whatever the field holds/);
  assert.match(fill, /`answer: null` is cleared/);
  assert.match(fill, /No placeholder ever survives/);
});

test('resumix-apply-ready lists what is Ready and follows resumix-apply for each', () => {
  const text = read(APPLY_READY);
  const keys = frontmatter(text);
  assert.equal(keys.get('disable-model-invocation'), 'true');
  assert.ok(!keys.has('arguments'));
  assert.ok(text.includes('mcp__resumix__list_applications'), 'it never lists applications');
  assert.match(text, /\{ "status": "ready" \}/);
  assert.ok(text.includes('.claude/skills/resumix-apply/SKILL.md'), 'it never reads resumix-apply');
  assert.ok(existsSync(join(ROOT, APPLY)), `${APPLY} is missing`);
  assert.match(text, /Never start the next application on your own/);
});

test('every Playwright tool named in agent/ is one the pinned version serves', () => {
  assert.ok(
    read('agent/.mcp.json').includes(`"${PLAYWRIGHT_VERSION}"`),
    `agent/.mcp.json no longer runs ${PLAYWRIGHT_VERSION}: re-check PLAYWRIGHT_TOOLS against ` +
      `the new version's README, then update both. ${RULES}`,
  );

  let seen = 0;
  for (const file of agentFiles()) {
    for (const [, name = ''] of read(file).matchAll(QUALIFIED_PLAYWRIGHT)) {
      seen++;
      assert.ok(
        PLAYWRIGHT_TOOLS.has(name),
        `${file} names mcp__playwright__${name}, which ${PLAYWRIGHT_VERSION} does not serve ` +
          `by default. ${RULES}`,
      );
    }
  }
  assert.ok(seen > 0, 'no mcp__playwright__ name found anywhere in agent/');

  for (const file of skillFiles()) {
    const [bare] = read(file).match(BARE_PLAYWRIGHT) ?? [];
    assert.equal(
      bare,
      undefined,
      `${file} names ${bare} bare; write mcp__playwright__${bare}, the name the model sees. ${RULES}`,
    );
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

test('the eval has four cases, each a posting and a checklist, and a discovery checklist', () => {
  const text = read(EVAL);
  const cases = text.split(/^## Case /m).slice(1);
  assert.equal(cases.length, 4, `${EVAL} must hold four "## Case" sections. ${RULES}`);
  for (const one of cases) {
    const title = one.split('\n', 1)[0];
    assert.match(one, /^```/m, `case "${title}" has no fenced posting`);
    assert.match(one, /^- \[ \] /m, `case "${title}" has no "- [ ]" checklist`);
  }

  const discovery = section(text, '## Discovery checklist');
  assert.ok(discovery, `${EVAL} has no "## Discovery checklist" section. ${RULES}`);
  assert.match(discovery, /^- \[ \] /m, `the discovery checklist has no "- [ ]" items`);
});

test('the apply eval has two cases, each with a checklist', () => {
  const text = read(APPLY_EVAL);
  const cases = text.split(/^## Case /m).slice(1);
  assert.equal(cases.length, 2, `${APPLY_EVAL} must hold two "## Case" sections. ${RULES}`);
  for (const one of cases) {
    const title = one.split('\n', 1)[0];
    assert.match(one, /^- \[ \] /m, `case "${title}" has no "- [ ]" checklist`);
  }
});

test('every career-ops mode is routed, and the routing is read from the data directory', () => {
  // career-ops' router may resolve modes/ against the submodule; the
  // workspace's CLAUDE.md, loaded in every session, says where it is.
  assert.ok(read('agent/CLAUDE.md').includes('$CAREER_OPS_DATA_DIR/modes/_custom.md'));
  const text = read(ROUTING);
  // A job in Resumix is looked up before any tracker step, and its apply
  // goes through Resumix rather than career-ops' apply mode (D10).
  assert.ok(text.includes('mcp__resumix__list_applications'));
  assert.ok(text.includes('/resumix-apply'));
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

// The download script, run the way /resumix-apply runs it, against a
// node:http server on 127.0.0.1 standing in for Resumix. It runs from a copy
// in a scratch directory, so its .apply-files/ lands there and never in the
// worktree. Its environment is built here, never inherited, so a real
// RESUMIX_MCP_TOKEN in the calling shell can never be sent anywhere.

const TOKEN = 'rmx_agent-skills-test-token';
const RESUME_ID = '91c00000-0000-4000-8000-000000000001';
const LETTER_ID = 'f1e00000-0000-4000-8000-000000000002';
const SAMPLE_ID = 'f1e00000-0000-4000-8000-000000000003';
const NOT_PDF_ID = 'f1e00000-0000-4000-8000-000000000004';
const APPLICATION_ID = '5b7e0000-0000-4000-8000-000000000005';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

const SERVED: Record<string, string> = {
  [`/api/mcp/files/resume-pdf/${RESUME_ID}`]: '%PDF-1.5 resume',
  [`/api/mcp/files/application-file/${LETTER_ID}`]: '%PDF-1.5 letter',
  [`/api/mcp/files/application-file/${SAMPLE_ID}`]: 'a take-home, as text',
  [`/api/mcp/files/application-file/${NOT_PDF_ID}`]: '<html>not a pdf</html>',
};

/** Every request the stand-in saw: its path and its Authorization header. */
const requests: { url: string; authorization: string | undefined }[] = [];
const resumix = createServer((request, response) => {
  requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
  const body = request.method === 'GET' ? SERVED[request.url ?? ''] : undefined;
  if (body === undefined) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"file not found"}');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/octet-stream' });
  response.end(body);
});
const listening = new Promise<number>((resolve) => {
  resumix.listen(0, '127.0.0.1', () => resolve((resumix.address() as AddressInfo).port));
});
after(() => resumix.close());

let copies = 0;
/** A fresh agent/ holding only the script, as claude.sh's directory would. */
function agentCopy(): string {
  const dir = join(scratch, `agent-${++copies}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, FETCHER), join(dir, 'fetch-apply-files.sh'));
  return dir;
}

interface Fetched {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Async, not spawnSync: the stand-in server answers on this process's event loop. */
async function fetchFiles(
  agentDir: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<Fetched> {
  const port = await listening;
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    RESUMIX_MCP_URL: `http://127.0.0.1:${port}/api/mcp`,
    RESUMIX_MCP_TOKEN: TOKEN,
  };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete base[key];
    else base[key] = value;
  }
  const child = spawn('bash', [join(agentDir, 'fetch-apply-files.sh'), ...args], {
    cwd: agentDir,
    // Built from nothing on purpose; the app's ProcessEnv type requires a
    // NODE_ENV the script has no use for.
    env: base as NodeJS.ProcessEnv,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve));
  return { status, stdout, stderr };
}

function filesDir(agentDir: string): string {
  return join(agentDir, '.apply-files', APPLICATION_ID);
}

test('the download script is tracked as executable, and its folder is gitignored', () => {
  assert.match(
    git('ls-files', '-s', FETCHER),
    /^100755 /,
    `${FETCHER} is not tracked with mode 100755. ${RULES}`,
  );
  // Playwright reads uploads only from under agent/, so the PDFs live there,
  // and must never be committed.
  assert.equal(git('check-ignore', 'agent/.apply-files/x.pdf').trim(), 'agent/.apply-files/x.pdf');
});

test('the download script writes each file, prints its path, and sends the bearer', async () => {
  const agentDir = agentCopy();
  // A file from an earlier run must never be uploaded by mistake.
  mkdirSync(filesDir(agentDir), { recursive: true });
  writeFileSync(join(filesDir(agentDir), 'stale.pdf'), '%PDF stale');
  const before = requests.length;

  const result = await fetchFiles(agentDir, [
    APPLICATION_ID,
    `/api/mcp/files/resume-pdf/${RESUME_ID}`,
    'Chris_Pyle_Halcyon_Resume.pdf',
    `/api/mcp/files/application-file/${LETTER_ID}`,
    'Chris_Pyle_Halcyon_Cover_Letter.pdf',
    `/api/mcp/files/application-file/${SAMPLE_ID}`,
    'take-home notes.txt',
  ]);
  assert.equal(result.status, 0, result.stderr);

  const dir = filesDir(agentDir);
  assert.equal(
    result.stdout,
    [
      join(dir, 'Chris_Pyle_Halcyon_Resume.pdf'),
      join(dir, 'Chris_Pyle_Halcyon_Cover_Letter.pdf'),
      join(dir, 'take-home notes.txt'),
    ].join('\n') + '\n',
  );
  assert.deepEqual(readdirSync(dir).sort(), [
    'Chris_Pyle_Halcyon_Cover_Letter.pdf',
    'Chris_Pyle_Halcyon_Resume.pdf',
    'take-home notes.txt',
  ]);
  assert.equal(readFileSync(join(dir, 'Chris_Pyle_Halcyon_Resume.pdf'), 'utf8'), '%PDF-1.5 resume');
  assert.equal(readFileSync(join(dir, 'take-home notes.txt'), 'utf8'), 'a take-home, as text');

  const sent = requests.slice(before);
  assert.deepEqual(
    sent.map((r) => r.url),
    [
      `/api/mcp/files/resume-pdf/${RESUME_ID}`,
      `/api/mcp/files/application-file/${LETTER_ID}`,
      `/api/mcp/files/application-file/${SAMPLE_ID}`,
    ],
  );
  for (const request of sent) assert.equal(request.authorization, `Bearer ${TOKEN}`);
  assert.ok(!result.stdout.includes(TOKEN) && !result.stderr.includes(TOKEN));
});

test('a file Resumix will not send fails the run, and leaves no folder', async () => {
  for (const [path, name] of [
    [`/api/mcp/files/application-file/${UNKNOWN_ID}`, 'missing.pdf'],
    // Served, but not a PDF: never uploaded as one.
    [`/api/mcp/files/application-file/${NOT_PDF_ID}`, 'letter.pdf'],
  ] as const) {
    const agentDir = agentCopy();
    const result = await fetchFiles(agentDir, [
      APPLICATION_ID,
      `/api/mcp/files/resume-pdf/${RESUME_ID}`,
      'resume.pdf',
      path,
      name,
    ]);
    assert.notEqual(result.status, 0, name);
    assert.equal(result.stdout, '', name);
    assert.match(result.stderr, /Nothing was downloaded/, name);
    assert.ok(!existsSync(filesDir(agentDir)), `${name}: the folder was left behind`);
  }
});

test('the download script refuses anything but packet paths and plain names', async () => {
  const resume = `/api/mcp/files/resume-pdf/${RESUME_ID}`;
  const refused: [string, string[], Record<string, string | undefined>][] = [
    ['the MCP endpoint itself', [APPLICATION_ID, '/api/mcp', 'x.pdf'], {}],
    ['another API path', [APPLICATION_ID, `/api/applications/${RESUME_ID}/pdf`, 'x.pdf'], {}],
    ['an absolute URL', [APPLICATION_ID, `http://example.test${resume}`, 'x.pdf'], {}],
    ['a slash in a name', [APPLICATION_ID, resume, '../escape.pdf'], {}],
    ['a hidden name', [APPLICATION_ID, resume, '.profile'], {}],
    ['a control character', [APPLICATION_ID, resume, 'a\tb.pdf'], {}],
    ['a name twice', [APPLICATION_ID, resume, 'a.pdf', resume, 'a.pdf'], {}],
    ['no application id', ['not-a-uuid', resume, 'x.pdf'], {}],
    ['a path with no name', [APPLICATION_ID, resume], {}],
    ['no token', [APPLICATION_ID, resume, 'x.pdf'], { RESUMIX_MCP_TOKEN: undefined }],
    ['no URL', [APPLICATION_ID, resume, 'x.pdf'], { RESUMIX_MCP_URL: undefined }],
    [
      'a URL that is not the MCP endpoint',
      [APPLICATION_ID, resume, 'x.pdf'],
      { RESUMIX_MCP_URL: 'http://127.0.0.1:9/api/other' },
    ],
  ];
  for (const [why, args, env] of refused) {
    const agentDir = agentCopy();
    const before = requests.length;
    const result = await fetchFiles(agentDir, args, env);
    assert.notEqual(result.status, 0, `ran with ${why}`);
    assert.equal(result.stdout, '', why);
    assert.equal(requests.length, before, `${why}: a request was sent`);
    assert.ok(!existsSync(filesDir(agentDir)), `${why}: a folder was made`);
  }

  const unset = await fetchFiles(agentCopy(), [APPLICATION_ID, resume, 'x.pdf'], {
    RESUMIX_MCP_TOKEN: undefined,
  });
  assert.match(unset.stderr, /start the session with \.\/claude\.sh/i);
});
