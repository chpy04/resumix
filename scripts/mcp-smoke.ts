/**
 * Drives `/api/mcp` over real HTTP the way an MCP client does: requests
 * with no token or a foreign one, `initialize`, `notifications/initialized`,
 * `tools/list`, the `ping` tool, and a `GET` (D-040). The unit tests prove the protocol without a server;
 * this proves the route, the token check and the database behind it.
 *
 * Then it does what the agent does first (D-042): reads the library, logs an
 * application, finds it again, records two of its form's questions (D-047),
 * remembers one in-process, as the review page's checkbox would, and links
 * that saved answer to a third (D-048), selects a small resume into it,
 * which the real sidecar compiles, writes its cover letter in plain text
 * (D-046), and submits it for review (D-044). Then the apply pass (D-050):
 * Chris's approval in-process, the packet, its files over HTTP, a reported
 * question that sends it back to review, approval again, and
 * `mark_applied`. That application and its letter are archived and its
 * saved answer archived when the script ends, so later specs' boards stay
 * as they were. Its resume is deleted only if nothing pinned a snapshot of
 * it: once one is pinned it is the record of what was sent (D-032).
 *
 * Final approval compiles here, in this process, so it needs
 * `LATEX_SERVICE_URL` as the server does.
 *
 * It needs a running server. `npm run verify` runs it from
 * `e2e/mcp.spec.ts`, against Playwright's own server; by hand, start
 * `npm run dev` and run `npm run mcp:smoke`.
 *
 * The token is minted here, for the first user (the seeded one, as in dev
 * mode), and revoked when the script ends, pass or fail. A token minted in
 * advance would not survive: `verify` reseeds, which wipes them.
 *
 * Development only (C8, C14). It reads `MCP_SMOKE_URL`, never
 * `RESUMIX_MCP_URL`, which is the agent workspace's name for production,
 * and it refuses a non-loopback host, production's web port and production's
 * database port.
 *
 * Usage:
 *   npm run mcp:smoke
 *   MCP_SMOKE_URL=http://localhost:3100/api/mcp npm run mcp:smoke
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { approveApplication } from '../lib/application-approval.ts';
import { db, sql } from '../lib/db/index.ts';
import { createApiToken, revokeApiToken } from '../lib/queries/api-tokens.ts';
import {
  approveApplicationQuestions,
  setQuestionRemembered,
} from '../lib/queries/application-questions.ts';
import {
  approveSection,
  getApplicationRow,
  updateApplication,
} from '../lib/queries/applications.ts';
import { updateCoverLetter } from '../lib/queries/cover-letters.ts';
import { deleteResume } from '../lib/queries/resumes.ts';
import { archiveSavedAnswer } from '../lib/queries/saved-answers.ts';
import { getFirstUser } from '../lib/queries/users.ts';

const DEFAULT_URL = 'http://localhost:3000/api/mcp';
// What a current client sends, written out rather than imported, so this
// checks the server from the client's side.
const PROTOCOL_VERSION = '2025-11-25';

/** Every tool `tools/list` must offer. */
const TOOL_NAMES = [
  'ping',
  'get_library',
  'get_saved_answers',
  'list_applications',
  'get_application',
  'get_apply_packet',
  'create_application',
  'add_questions',
  'set_resume_selection',
  'set_cover_letter_body',
  'submit_for_review',
  'report_question',
  'mark_applied',
];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const PROD_WEB_PORT = '39000';
const PROD_DB_PORT = '39432';

/** The endpoint to hit, or null after saying on stderr why not. */
function target(): URL | null {
  const raw = process.env.MCP_SMOKE_URL ?? DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error(`mcp:smoke: MCP_SMOKE_URL is not a URL: ${raw}`);
    return null;
  }
  if (!LOOPBACK.has(url.hostname)) {
    console.error(`mcp:smoke: refusing ${url.host}; this runs against a local dev server only.`);
    return null;
  }
  if (url.port === PROD_WEB_PORT) {
    console.error(`mcp:smoke: refusing port ${PROD_WEB_PORT}, which is production.`);
    return null;
  }

  const db = process.env.DATABASE_URL;
  if (db && URL.canParse(db) && new URL(db).port === PROD_DB_PORT) {
    console.error(`mcp:smoke: DATABASE_URL is on port ${PROD_DB_PORT}, which is production.`);
    return null;
  }
  return url;
}

function check(label: string): void {
  console.log(`  ok  ${label}`);
}

/** A minimal MCP client: numbers its requests, and once told the agreed
 *  version, sends it on every request after `initialize`, as a real one does. */
function client(url: URL, secret: string) {
  let nextId = 1;
  let protocolVersion: string | null = null;

  return {
    agree(version: string) {
      protocolVersion = version;
    },

    request(method: string, params?: Record<string, unknown>) {
      return { jsonrpc: '2.0', id: nextId++, method, ...(params ? { params } : {}) };
    },

    /**
     * `authorization` replaces the token's header (null sends none), and
     * `body` replaces the encoded message, for the requests that must fail.
     */
    async send(
      message: Record<string, unknown> | null,
      options: { authorization?: string | null; body?: string; method?: string } = {},
    ): Promise<Response> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const authorization =
        options.authorization === undefined ? `Bearer ${secret}` : options.authorization;
      if (authorization !== null) headers.authorization = authorization;
      if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;

      try {
        return await fetch(url, {
          method: options.method ?? 'POST',
          headers,
          body: options.body ?? (message ? JSON.stringify(message) : undefined),
        });
      } catch (err) {
        throw new Error(`could not reach ${url} — is the dev server running?`, { cause: err });
      }
    },
  };
}

/** The `result` of a 200 `application/json` response. */
async function resultOf(response: Response): Promise<Record<string, unknown>> {
  assert.equal(response.status, 200, `expected 200, got ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  const body = (await response.json()) as { result?: Record<string, unknown> };
  assert.ok(body.result, `expected a result, got ${JSON.stringify(body)}`);
  return body.result;
}

type Mcp = ReturnType<typeof client>;

interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

async function callTool(mcp: Mcp, name: string, args: Record<string, unknown>) {
  const response = await mcp.send(mcp.request('tools/call', { name, arguments: args }));
  return (await resultOf(response)) as unknown as ToolCallResult;
}

/** A tool's JSON answer, which must not be an error. */
async function callJson<T>(mcp: Mcp, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await callTool(mcp, name, args);
  assert.equal(result.isError, undefined, `${name} failed: ${result.content[0]?.text}`);
  return JSON.parse(result.content[0]?.text ?? '') as T;
}

interface LibraryJson {
  experiences: { id: string; bullets: { id: string }[] }[];
  projects: { id: string }[];
  skill_rows: { id: string; skills: { id: string }[] }[];
}

/**
 * The agent's first moves, one call to each library and application tool.
 * The application it logs is archived, its resume deleted and the answer it
 * remembers archived, however this ends.
 */
async function smokeTools(mcp: Mcp, userId: string, url: URL, secret: string): Promise<void> {
  const library = await callJson<LibraryJson>(mcp, 'get_library', {});
  assert.ok(library.experiences.length > 0, 'get_library: no experiences');
  check(
    `get_library returns ${library.experiences.length} experience(s), ` +
      `${library.projects.length} project(s), ${library.skill_rows.length} skill row(s)`,
  );

  const tag = randomUUID().slice(0, 8);
  const postingUrl = `https://jobs.example.test/mcp-smoke/${tag}`;
  const created = await callJson<{ application_id: string; status: string }>(
    mcp,
    'create_application',
    {
      company: `MCP Smoke ${tag}`,
      role_title: 'Smoke Tester',
      posting_url: postingUrl,
      job_description: 'A posting scripts/mcp-smoke.ts made up.',
      agent_summary: 'Logged by the MCP smoke; archived when it ends.',
      fit_score: 3.2,
    },
  );
  const applicationId = created.application_id;
  let rememberedId: string | null = null;
  try {
    assert.equal(created.status, 'proposing');
    check('create_application logs one in proposing');

    const listed = await callJson<{ application_id: string }[]>(mcp, 'list_applications', {
      posting_url: postingUrl,
    });
    assert.deepEqual(
      listed.map((a) => a.application_id),
      [applicationId],
    );
    const got = await callJson<{ status: string }>(mcp, 'get_application', {
      application_id: applicationId,
    });
    assert.equal(got.status, 'proposing');
    check('list_applications finds it by posting_url, and get_application reads it back');

    type Recorded = { questions: { question_id: string; outcome: string; note?: string }[] };
    const questions = [
      {
        field_ref: { page: 0, label: 'Full name' },
        prompt: 'Full name',
        kind: 'text',
        required: true,
        source: 'profile',
        proposed_answer: 'Smoke Tester',
      },
      {
        field_ref: { page: 0, label: 'Gender' },
        prompt: 'Gender',
        kind: 'choice',
        options: ['Female', 'Male', 'Decline to answer'],
        required: false,
        source: 'agent',
        proposed_answer: 'Decline to answer',
      },
    ];
    const added = await callJson<Recorded>(mcp, 'add_questions', {
      application_id: applicationId,
      questions,
    });
    assert.deepEqual(
      added.questions.map((q) => [q.outcome, q.note]),
      [
        ['added', undefined],
        ['added', 'eeo_answer_dropped'],
      ],
    );
    const [name, gender] = added.questions;
    assert.ok(name && gender);
    const resent = await callJson<Recorded>(mcp, 'add_questions', {
      application_id: applicationId,
      questions: [questions[0]],
    });
    assert.deepEqual(resent.questions, [{ question_id: name.question_id, outcome: 'unchanged' }]);
    const asked = await callJson<{
      questions: { question_id: string; answer: unknown; is_eeo: boolean }[];
    }>(mcp, 'get_application', { application_id: applicationId });
    assert.deepEqual(
      asked.questions.map((q) => [q.question_id, q.answer, q.is_eeo]),
      [
        [name.question_id, 'Smoke Tester', false],
        [gender.question_id, null, true],
      ],
    );
    check('add_questions drops the EEO answer, a re-send is unchanged, get_application lists both');

    // What ticking "remember this answer" does, then the agent's side.
    const remembered = await setQuestionRemembered(userId, name.question_id, true);
    rememberedId = remembered.savedAnswerId;
    assert.ok(rememberedId, 'remembering saved nothing');
    const saved = await callJson<{ saved_answer_id: string }[]>(mcp, 'get_saved_answers', {});
    assert.deepEqual(
      saved.find((a) => a.saved_answer_id === rememberedId),
      {
        saved_answer_id: rememberedId,
        prompt: 'Full name',
        kind: 'text',
        answer_mode: 'value',
        answer: 'Smoke Tester',
      },
    );
    const [preferred] = (
      await callJson<Recorded>(mcp, 'add_questions', {
        application_id: applicationId,
        questions: [
          {
            field_ref: { page: 1, label: 'Preferred name' },
            prompt: 'Preferred name',
            kind: 'text',
            required: false,
            saved_answer_id: rememberedId,
          },
        ],
      })
    ).questions;
    assert.equal(preferred?.outcome, 'added');
    const withLink = await callJson<{
      questions: { question_id: string; source: string; answer: unknown; approved_at: unknown }[];
    }>(mcp, 'get_application', { application_id: applicationId });
    const filled = withLink.questions.find((q) => q.question_id === preferred?.question_id);
    assert.equal(filled?.source, 'saved');
    assert.equal(filled?.answer, 'Smoke Tester');
    assert.ok(filled?.approved_at, 'a linked question arrives approved');
    const badLink = await callTool(mcp, 'add_questions', {
      application_id: applicationId,
      questions: [
        {
          field_ref: { page: 1, label: 'Nickname' },
          prompt: 'Nickname',
          kind: 'text',
          required: false,
          saved_answer_id: randomUUID(),
        },
      ],
    });
    assert.equal(badLink.isError, true, 'an unknown saved_answer_id was accepted');
    assert.match(badLink.content[0]?.text ?? '', /^Nothing was written/);
    check('get_saved_answers lists a remembered answer, and add_questions links it approved');

    // Built from the live library, not from Default's selection: earlier
    // specs may have archived some of what Default selects.
    const experience = library.experiences.find((e) => e.bullets.length > 0);
    const skillRow = library.skill_rows.find((r) => r.skills.length > 0);
    assert.ok(experience?.bullets[0] && skillRow?.skills[0], 'nothing small to select');
    const selection = {
      experiences: [experience.id],
      experience_bullets: { [experience.id]: [experience.bullets[0].id] },
      projects: [],
      project_bullets: {},
      skill_rows: [skillRow.id],
      skills: { [skillRow.id]: [skillRow.skills[0].id] },
    };
    const set = await callJson(mcp, 'set_resume_selection', {
      application_id: applicationId,
      selection,
    });
    assert.deepEqual(set, { ok: true, pages: 1, overflow: null });
    check('set_resume_selection compiles a small selection to one page');

    const refused = await callTool(mcp, 'set_resume_selection', {
      application_id: applicationId,
      selection: { ...selection, experiences: [experience.id, randomUUID()] },
    });
    assert.equal(refused.isError, true, 'an unknown id was accepted');
    assert.match(refused.content[0]?.text ?? '', /^Nothing was written/);
    const after = await callJson<{ selection: unknown }>(mcp, 'get_application', {
      application_id: applicationId,
    });
    assert.deepEqual(after.selection, selection);
    check('an unknown id is refused, and the selection is unchanged');

    // All thirteen characters the escaper replaces, so the real sidecar
    // proves each replacement exists in its TeX Live.
    const letterText =
      'October 13, 2026\n\nDear Hiring Team,\n\nEvery special as text: \\ { } $ & # ^ _ % ~ < > |.' +
      '\n\nBest,\nChris';
    const letter = await callJson(mcp, 'set_cover_letter_body', {
      application_id: applicationId,
      text: letterText,
    });
    assert.deepEqual(letter, { ok: true, pages: 1 });
    const linked = (await getApplicationRow(userId, applicationId))?.coverLetterId;
    assert.ok(linked, 'set_cover_letter_body linked no letter');
    const again = await callJson(mcp, 'set_cover_letter_body', {
      application_id: applicationId,
      text: letterText,
    });
    assert.deepEqual(again, { ok: true, pages: 1 });
    assert.equal((await getApplicationRow(userId, applicationId))?.coverLetterId, linked);
    check(
      'set_cover_letter_body compiles every special to one page, and writes the same letter twice',
    );

    // The real sidecar counts both documents' pages here too.
    const submitted = await callJson(mcp, 'submit_for_review', { application_id: applicationId });
    assert.deepEqual(submitted, {
      application_id: applicationId,
      status: 'needs_review',
      resume_pages: 1,
      cover_letter_pages: 1,
    });
    const inReview = await callJson<{ status: string }>(mcp, 'get_application', {
      application_id: applicationId,
    });
    assert.equal(inReview.status, 'needs_review');
    check('submit_for_review moves it to needs_review, and get_application agrees');

    const unknown = randomUUID();
    const missing = await callTool(mcp, 'submit_for_review', { application_id: unknown });
    assert.equal(missing.isError, true, 'an unknown application was submitted');
    assert.equal(
      missing.content[0]?.text,
      `No application ${unknown}. Call list_applications to find its application_id.`,
    );
    check('submit_for_review on an unknown id is isError');

    await smokeApply(mcp, userId, applicationId, url, secret, {
      name: name.question_id,
      gender: gender.question_id,
    });
  } finally {
    // Archived, never deleted (D-048), so the agent never links it again.
    if (rememberedId) await archiveSavedAnswer(db, userId, rememberedId);
    const row = await getApplicationRow(userId, applicationId);
    await updateApplication(userId, applicationId, { isArchived: true });
    // Once final approval has pinned a snapshot of it, the resume is the
    // record of what was sent and stays (D-032): `deleteResume` refuses it.
    if (row?.resumeId && !row.resumePdfId) await deleteResume(userId, row.resumeId);
    // Archived, never deleted (D-011), so the letter library stays as it was.
    if (row?.coverLetterId) {
      await updateCoverLetter(userId, row.coverLetterId, { isArchived: true });
    }
  }
}

interface PacketJson {
  status: string;
  resume: { filename: string; url: string };
  cover_letter: { filename: string; url: string } | null;
  questions: { question_id: string; approved: boolean; answer: unknown }[];
}

/**
 * The apply pass (D-050), on the application `smokeTools` submitted. Chris's
 * side, approving it, happens in-process, as the token is minted: there is
 * no approval tool (NOT EXPOSED). Final approval compiles with the real
 * sidecar here, so this process needs `LATEX_SERVICE_URL`.
 */
async function smokeApply(
  mcp: Mcp,
  userId: string,
  applicationId: string,
  url: URL,
  secret: string,
  questions: { name: string; gender: string },
): Promise<void> {
  const approve = async (questionIds: string[]) => {
    if (questionIds.length > 0) {
      await approveApplicationQuestions(userId, applicationId, questionIds);
    }
    const approved = await approveApplication(userId, applicationId);
    assert.ok(approved.ok, `final approval failed: ${JSON.stringify(approved)}`);
  };
  await approveSection(userId, applicationId, 'resume');
  await approveSection(userId, applicationId, 'coverLetter');
  // The EEO question has no answer and is optional, so it stays unapproved.
  await approve([questions.name]);

  const packet = await callJson<PacketJson>(mcp, 'get_apply_packet', {
    application_id: applicationId,
  });
  assert.equal(packet.status, 'ready');
  assert.match(packet.resume.url, /^\/api\/mcp\/files\/resume-pdf\/[0-9a-f-]{36}$/);
  assert.ok(packet.cover_letter, 'the letter is not in the packet');
  assert.match(packet.cover_letter.filename, /_Cover_Letter\.pdf$/);
  const byId = new Map(packet.questions.map((q) => [q.question_id, q]));
  assert.deepEqual(
    [byId.get(questions.name)?.answer, byId.get(questions.gender)?.approved],
    ['Smoke Tester', false],
  );
  assert.equal(byId.get(questions.gender)?.answer, null, 'an unapproved answer is left blank');
  check('get_apply_packet answers the approved packet, with an unapproved question blank');

  // The files, over real HTTP, as the agent's script fetches them.
  const fetchFile = (path: string, authorization: string | null = `Bearer ${secret}`) =>
    fetch(new URL(path, url), { headers: authorization ? { authorization } : {} });
  for (const file of [packet.resume, packet.cover_letter]) {
    const response = await fetchFile(file.url);
    assert.equal(response.status, 200, `${file.url}: expected 200, got ${response.status}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString('latin1'), '%PDF', `${file.url} is not a PDF`);
  }
  assert.equal((await fetchFile(packet.resume.url, null)).status, 401, 'no token');
  assert.equal((await fetchFile(packet.resume.url, 'Bearer abc')).status, 401, 'not rmx_');
  const other = `/api/mcp/files/resume-pdf/${randomUUID()}`;
  assert.equal((await fetchFile(other)).status, 404, 'an unknown file');
  check('both packet files download with the token, and are 401 without it, 404 unknown');

  const reported = await callJson<{ question_id: string; outcome: string; status: string }>(
    mcp,
    'report_question',
    {
      application_id: applicationId,
      question: {
        field_ref: { page: 2, label: 'Are you 18 or older?' },
        prompt: 'Are you 18 or older?',
        kind: 'bool',
        required: true,
        source: 'profile',
        proposed_answer: 'yes',
      },
    },
  );
  assert.deepEqual([reported.outcome, reported.status], ['added', 'needs_review']);
  const refused = await callTool(mcp, 'get_apply_packet', { application_id: applicationId });
  assert.equal(refused.isError, true, 'a reopened application still has a packet');
  assert.match(refused.content[0]?.text ?? '', /^This application is in Needs review/);
  assert.equal((await fetchFile(packet.resume.url)).status, 404, 'a reopened packet file');
  check('report_question sends it back to review, and the packet and its files go with it');

  await approve([reported.question_id]);
  const applied = await callJson<{ status: string; applied_at: string | null }>(
    mcp,
    'mark_applied',
    { application_id: applicationId },
  );
  assert.equal(applied.status, 'applied');
  assert.ok(applied.applied_at, 'applied_at is not stamped');
  const sent = await callJson<{ status: string }>(mcp, 'get_application', {
    application_id: applicationId,
  });
  assert.equal(sent.status, 'applied');
  const again = await callTool(mcp, 'mark_applied', { application_id: applicationId });
  assert.equal(again.isError, true, 'an applied application was marked applied twice');
  check('mark_applied moves it to applied once, and get_application agrees');
}

async function main() {
  const url = target();
  if (!url) {
    process.exitCode = 1;
    return;
  }

  let minted: { userId: string; tokenId: string } | null = null;
  try {
    const user = await getFirstUser();
    if (!user) throw new Error('no users exist — run `npm run db:seed` first');

    const { token, secret } = await createApiToken(user.id, 'mcp-smoke');
    minted = { userId: user.id, tokenId: token.id };
    const mcp = client(url, secret);

    console.log(`mcp:smoke against ${url}`);

    const initialize = mcp.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'resumix-mcp-smoke', version: '0' },
    });

    // C2: only an rmx_ token opens the door, and it is checked first, before
    // the body is parsed and before the method is considered.
    const anonymous = await mcp.send(initialize, { authorization: null });
    assert.equal(anonymous.status, 401, `no token: expected 401, got ${anonymous.status}`);
    check('no token is 401');

    const foreign = await mcp.send(initialize, { authorization: 'Bearer abc' });
    assert.equal(foreign.status, 401, `Bearer abc: expected 401, got ${foreign.status}`);
    check('a bearer credential that is not rmx_ is 401');

    const unparsed = await mcp.send(null, { authorization: null, body: '{not json' });
    assert.equal(unparsed.status, 401, `no token, bad JSON: expected 401, got ${unparsed.status}`);
    check('no token is 401 even when the body is not JSON');

    const anonymousGet = await mcp.send(null, { authorization: null, method: 'GET' });
    assert.equal(
      anonymousGet.status,
      401,
      `no token, GET: expected 401, got ${anonymousGet.status}`,
    );
    check('no token is 401 on GET too, not 405');

    const initResponse = await mcp.send(initialize);
    const init = await resultOf(initResponse);
    assert.equal(init.protocolVersion, PROTOCOL_VERSION);
    assert.ok((init.capabilities as Record<string, unknown> | undefined)?.tools);
    assert.equal(initResponse.headers.get('mcp-session-id'), null, 'no session id is issued');
    mcp.agree(PROTOCOL_VERSION);
    check(`initialize is 200 application/json, protocol ${PROTOCOL_VERSION}, no session id`);

    const initialized = await mcp.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(initialized.status, 202);
    assert.equal(await initialized.text(), '');
    check('notifications/initialized is 202 with an empty body');

    const list = await resultOf(await mcp.send(mcp.request('tools/list')));
    const tools = list.tools as { name: string; inputSchema: { type?: string } }[];
    const names = tools.map((t) => t.name);
    for (const name of TOOL_NAMES) {
      assert.ok(names.includes(name), `tools/list has no ${name}: ${names.join(', ')}`);
    }
    for (const tool of tools) assert.equal(tool.inputSchema.type, 'object', tool.name);
    check(`tools/list has ${tools.length} tool(s), including ${TOOL_NAMES.join(', ')}`);

    const call = await resultOf(
      await mcp.send(mcp.request('tools/call', { name: 'ping', arguments: {} })),
    );
    assert.equal(call.isError, undefined, `ping failed: ${JSON.stringify(call)}`);
    const content = call.content as { type: string; text: string }[];
    assert.equal(content[0]?.text, user.email);
    check(`the ping tool answers ${user.email}`);

    await smokeTools(mcp, user.id, url, secret);

    const get = await mcp.send(null, { method: 'GET' });
    assert.equal(get.status, 405, `GET: expected 405, got ${get.status}`);
    check('GET is 405');

    console.log('mcp:smoke passed');
  } finally {
    // Revoked, not deleted: tokens are never deleted (D-039).
    if (minted) await revokeApiToken(minted.userId, minted.tokenId);
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
