# latex service

A tiny sidecar that turns a `.tex` string into a PDF using real `pdflatex`
(TeX Live), for the Resumix render pipeline. Not part of the Next.js app —
see `docs/API.md` for the wire contract and `docs/ARCHITECTURE.md` for how
it fits in.

## Contract

```
POST /compile   { tex: string }
             -> { ok, pdfBase64?, pages, errors, log, durationMs }
GET  /health -> { ok: true }
```

A LaTeX compile failure is a normal result, not a transport error: `POST
/compile` always answers `200` with `ok: false` (and no `pdfBase64`) when
the `.tex` fails to compile. `400` means the request itself was malformed
(bad/missing JSON, oversized body). `500`/`503` mean something went wrong
in the service itself (shouldn't happen in normal operation).

**Deviation from the docs:** `docs/ARCHITECTURE.md` says "Express", but
`server.js` is a zero-dependency `node:http` server. It satisfies the exact
same HTTP contract with a much smaller, dependency-free image and no
`npm install` step in the Dockerfile.

## Behavior notes

- Every request gets its own `mkdtemp` working directory; it's removed
  (`fs.rm -rf`) in a `finally`, including on error/timeout.
- Runs `pdflatex -interaction=nonstopmode -halt-on-error -file-line-error
  -no-shell-escape`, with `SOURCE_DATE_EPOCH=0` / `FORCE_SOURCE_DATE=1` so
  identical `.tex` input produces byte-identical PDF output.
- Reads the `.log` file (not stdout) to parse the page count
  (`Output written on ... (N pages, ...)`) and errors (lines starting with
  `!`, or with `-file-line-error`'s `path:line:` prefix, plus their `l.NNN`
  context line when present).
- Hard 20s timeout per compile (`LATEX_COMPILE_TIMEOUT_MS`); the child
  process is `SIGKILL`ed and the request still returns `ok: false` with a
  timeout error, not a hang.
- Request bodies capped at ~2MB (`LATEX_MAX_BODY_BYTES`) — oversized bodies
  get `400`.
- Compiles are limited to `LATEX_MAX_CONCURRENCY` (default 2) running at
  once; extra requests queue up to `LATEX_MAX_QUEUE` (default 8) and get
  `503` beyond that, so a burst of preview requests can't fork-bomb the
  container.

Env vars (all optional, sane defaults baked in):

| var | default | meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `LATEX_MAX_BODY_BYTES` | `2097152` (2MB) | request body cap |
| `LATEX_COMPILE_TIMEOUT_MS` | `20000` | hard per-compile timeout |
| `LATEX_MAX_CONCURRENCY` | `2` | concurrent `pdflatex` processes |
| `LATEX_MAX_QUEUE` | `8` | requests allowed to wait for a slot |

## Security

LaTeX can read/write arbitrary files under its working directory and, if
allowed, shell out via `\write18`. This service:

- always passes `-no-shell-escape` (shell-escape is inert regardless of any
  `texmf.cnf` setting on the image);
- runs as a non-root user (`latex`, uid 10001) inside the container, with
  its own isolated `HOME`/`TEXMFVAR`/etc. per request, scoped to that
  request's temp directory;
- has no filesystem access to anything outside its own temp dirs that
  matters (it never touches app data or secrets).

**This service must never be exposed directly to the public internet.**
It has no authentication of its own — the Next.js app is the only intended
caller, over a private network (the docker-compose network in dev, Fly.io
private networking / `fly proxy` in prod). If you must reach it from
outside that network for debugging, tunnel to it — do not open its port on
a public load balancer.

## Build & run locally

Via docker-compose (from the repo root, `docker-compose.yml` already wires
this up as the `latex` service on port `8080`):

```sh
docker compose build latex
docker compose up -d latex
curl -s localhost:8080/health
```

Standalone:

```sh
cd services/latex
docker build -t resumix-latex .
docker run --rm -p 8080:8080 resumix-latex
```

Compile the real resume and confirm you get a PDF back:

```sh
node -e "const fs=require('fs');const tex=fs.readFileSync('../../docs/reference/v1-resume.tex','utf8');fetch('http://localhost:8080/compile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tex})}).then(r=>r.json()).then(j=>{console.log({ok:j.ok,pages:j.pages,errors:j.errors});if(j.pdfBase64)fs.writeFileSync('/tmp/t2.pdf',Buffer.from(j.pdfBase64,'base64'))})"
file /tmp/t2.pdf
```

The Next.js app talks to this over `lib/latex.ts`, configured via the
`LATEX_SERVICE_URL` env var (e.g. `http://latex:8080` in docker-compose,
or the Fly.io private URL in prod).

## Deploying to Fly.io

This is a normal single-Dockerfile Fly app; deploy it as its own Fly app
separate from the Next.js app, and reach it over Fly's private networking
(`.internal` DNS / 6PN) rather than the public internet.

```sh
cd services/latex
fly launch --no-deploy --name resumix-latex   # creates fly.toml, pick a region close to the app
```

In the generated `fly.toml`:

- set `internal_port = 8080` under `[http_service]` (or `[[services]]` on
  older config), matching `EXPOSE 8080` in the Dockerfile;
- **set `force_https = false` and do not rely on Fly's public HTTP
  service for this app** — the intent is that only the Next.js app reaches
  it, over Fly's private `6PN` network at
  `http://resumix-latex.internal:8080` (or `http://resumix-latex.flycast:8080`
  for a private-only load-balanced address). If you want to fully close the
  public edge, remove the `[http_service]` block's public routing or use
  `fly ips` to avoid allocating a public IP for this app at all.
- give it enough memory for TeX Live + a couple of concurrent `pdflatex`
  processes — `shared-cpu-1x` with 512MB–1GB is comfortable for single-page
  resumes; bump `LATEX_MAX_CONCURRENCY` down if memory is tight.
- no persistent volume is needed — everything lives in per-request temp
  dirs that are deleted immediately after each compile.

Then:

```sh
fly deploy
```

And in the Next.js app's environment (wherever it's deployed), set:

```
LATEX_SERVICE_URL=http://resumix-latex.internal:8080
```

(or `https://resumix-latex.flycast:8080` if using Flycast — see Fly's
private networking docs for the current recommended internal address form).
