'use strict';

/**
 * Resumix latex compile service.
 *
 * Contract (docs/API.md, "Latex service"):
 *   POST /compile  { tex: string } -> { ok, pdfBase64?, pages, errors, log, durationMs }
 *   GET  /health   -> { ok: true }
 *
 * Deviation from docs/ARCHITECTURE.md: the docs say "Express", but this is a
 * plain node:http server with zero npm dependencies, to keep the image lean
 * and avoid pulling in a package manager step in the Docker build. It
 * satisfies the exact same HTTP contract.
 *
 * A compile failure (bad LaTeX) is a normal, expected result -> HTTP 200 with
 * `ok: false` and no `pdfBase64`. Only malformed requests (400) or genuine
 * service faults (500) use non-200 statuses.
 *
 * Security: pdflatex runs with -no-shell-escape (so \write18 is inert
 * regardless of texmf.cnf), each request gets its own throwaway temp
 * directory that is removed afterwards, and the process itself should be
 * run as a non-root user (see Dockerfile). This service is not meant to be
 * exposed to the public internet directly -- see README.md.
 */

const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = Number(process.env.LATEX_MAX_BODY_BYTES || 2 * 1024 * 1024); // ~2MB
const COMPILE_TIMEOUT_MS = Number(process.env.LATEX_COMPILE_TIMEOUT_MS || 20_000); // ~20s
const MAX_CONCURRENCY = Number(process.env.LATEX_MAX_CONCURRENCY || 2);
const MAX_QUEUE = Number(process.env.LATEX_MAX_QUEUE || 8);
const JOB_NAME = 'resume';

// ---------------------------------------------------------------------------
// Tiny concurrency limiter. A burst of preview requests should queue up (or
// get rejected once the queue is also full) rather than forking an unbounded
// number of pdflatex processes.
// ---------------------------------------------------------------------------

let active = 0;
const queue = [];

function acquireSlot() {
  return new Promise((resolve, reject) => {
    const tryClaim = () => {
      if (active >= MAX_CONCURRENCY) return false;
      active += 1;
      resolve(release);
      return true;
    };
    if (tryClaim()) return;
    if (queue.length >= MAX_QUEUE) {
      reject(new Error('queue full'));
      return;
    }
    queue.push(tryClaim);
  });

  function release() {
    active -= 1;
    while (queue.length > 0) {
      const tryNext = queue.shift();
      if (tryNext()) return;
    }
  }
}

// ---------------------------------------------------------------------------
// Log parsing. Ideas borrowed from the V1 compile.ts prior art: prefer the
// .log file over stdout, pull page count out of the "Output written on"
// line, and pull `!`-prefixed errors plus their `l.NNN` context line.
// ---------------------------------------------------------------------------

function parsePageCount(log) {
  const m = /Output written on .*?\((\d+) pages?,/.exec(log);
  return m ? Number(m[1]) : null;
}

// pdflatex reports errors two ways depending on style:
//   classic:          "! Undefined control sequence."
//   -file-line-error: "./resume.tex:12: Undefined control sequence."
// We run with -file-line-error (better line numbers for the UI) so we need
// to recognize both shapes.
const ERROR_LINE_RE = /^(!|\S+\.(?:tex|sty|cls|clo|def):\d+:)/;

function parseErrors(log) {
  const lines = log.split('\n');
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !ERROR_LINE_RE.test(line)) continue;
    const context = lines.slice(i + 1, i + 6).find((l) => l.startsWith('l.'));
    errors.push(context ? `${line.trim()} (${context.trim()})` : line.trim());
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

async function compile(tex) {
  const started = Date.now();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latex-'));
  const texPath = path.join(workDir, `${JOB_NAME}.tex`);
  const logPath = path.join(workDir, `${JOB_NAME}.log`);
  const pdfPath = path.join(workDir, `${JOB_NAME}.pdf`);

  try {
    await fs.writeFile(texPath, tex, 'utf8');

    // Isolated, writable-by-us-only TeX homes so a non-root, read-only-ish
    // container user never needs to touch anything outside the job's temp
    // dir. SOURCE_DATE_EPOCH/FORCE_SOURCE_DATE make identical input produce
    // byte-identical PDFs.
    const env = {
      PATH: process.env.PATH,
      HOME: workDir,
      TEXMFHOME: path.join(workDir, '.texmf'),
      TEXMFVAR: path.join(workDir, '.texmf-var'),
      TEXMFCONFIG: path.join(workDir, '.texmf-config'),
      SOURCE_DATE_EPOCH: '0',
      FORCE_SOURCE_DATE: '1',
    };

    const args = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-file-line-error',
      '-no-shell-escape',
      `${JOB_NAME}.tex`,
    ];

    const outputChunks = [];
    let timedOut = false;
    let spawnError = null;

    await new Promise((resolve) => {
      let child;
      try {
        child = spawn('pdflatex', args, { cwd: workDir, env });
      } catch (err) {
        spawnError = err;
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, COMPILE_TIMEOUT_MS);

      child.stdout.on('data', (d) => outputChunks.push(d));
      child.stderr.on('data', (d) => outputChunks.push(d));
      child.on('error', (err) => {
        spawnError = err;
      });
      child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (spawnError) {
      throw spawnError;
    }

    let log = Buffer.concat(outputChunks).toString('utf8');
    try {
      // pdflatex exits non-zero on error but still writes the .log file;
      // prefer it since it has richer context than stdout alone.
      log = await fs.readFile(logPath, 'utf8');
    } catch {
      // no .log file (e.g. pdflatex died before writing one); fall back.
    }

    const errors = parseErrors(log);
    const pages = parsePageCount(log);

    let pdfBase64;
    if (!timedOut && errors.length === 0) {
      try {
        pdfBase64 = (await fs.readFile(pdfPath)).toString('base64');
      } catch {
        // pdflatex reported no errors but produced no PDF; fall through to
        // ok: false below.
      }
    }

    if (timedOut && errors.length === 0) {
      errors.push(`! Compilation timed out after ${COMPILE_TIMEOUT_MS}ms.`);
      log += `\n! Compilation timed out after ${COMPILE_TIMEOUT_MS}ms.\n`;
    }

    return {
      ok: Boolean(pdfBase64) && errors.length === 0,
      pdfBase64,
      pages,
      errors,
      log,
      durationMs: Date.now() - started,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > MAX_BODY_BYTES) {
      reject(new Error('body too large'));
      req.destroy();
      return;
    }

    let size = 0;
    const chunks = [];
    let rejected = false;

    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!rejected) reject(err);
    });
  });
}

/**
 * Shared-secret gate. This service has no other authentication, and LaTeX can
 * read files on the box it runs on, so it must never be reachable by anyone but
 * the app. On Fly.io a Vercel caller cannot join the private 6PN mesh, so the
 * instance needs a public IP and this token is the only thing in front of it.
 *
 * Unset => open, which is fine for docker-compose on localhost but is logged
 * loudly at startup. See docs/DEPLOYMENT.md.
 */
const AUTH_TOKEN = process.env.LATEX_SERVICE_TOKEN || '';

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function tokenMatches(presented) {
  if (presented.length !== AUTH_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ AUTH_TOKEN.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(req) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
  return tokenMatches(presented);
}

const server = http.createServer(async (req, res) => {
  try {
    // /health stays open so container and platform health checks work without
    // having to distribute the token to them.
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'POST' && req.url === '/compile') {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { error: 'request body exceeds the 2MB limit' });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(body.toString('utf8'));
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }

      if (
        typeof payload !== 'object' ||
        payload === null ||
        typeof payload.tex !== 'string' ||
        payload.tex.length === 0
      ) {
        sendJson(res, 400, { error: '"tex" must be a non-empty string' });
        return;
      }

      let release;
      try {
        release = await acquireSlot();
      } catch {
        sendJson(res, 503, { error: 'latex service is at capacity, try again shortly' });
        return;
      }

      try {
        const result = await compile(payload.tex);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, {
          error: 'compile failed unexpectedly',
          detail: String(err && err.message ? err.message : err),
        });
      } finally {
        release();
      }
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, {
      error: 'internal error',
      detail: String(err && err.message ? err.message : err),
    });
  }
});

server.listen(PORT, () => {
  console.log(`latex service listening on :${PORT}`);
  if (!AUTH_TOKEN) {
    console.warn(
      '[latex] LATEX_SERVICE_TOKEN is unset — /compile is UNAUTHENTICATED. ' +
        'Fine on a private docker network; never deploy it this way.',
    );
  }
});
