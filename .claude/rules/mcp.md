---
paths:
  - 'lib/mcp/**'
  - 'app/api/mcp/**'
  - 'scripts/mcp-smoke.ts'
---

# MCP tools

`/api/mcp` is the agent's way into Resumix (D-040). `docs/API.md`, "MCP", is
the contract. The protocol (`lib/mcp/dispatch.ts`, `lib/mcp/http.ts`) is
finished and rarely needs touching; almost every change here is a new tool.

## Adding a tool

Four things, in one commit:

1. A module, `lib/mcp/tools/<name>.ts`, exporting one `defineTool(...)`.
2. One import and one entry in `TOOLS` (`lib/mcp/tools/index.ts`). The array
   order is the `tools/list` order.
3. One row in API.md's tool reference.
4. A test beside the module. `tools/index.test.ts` already checks every
   entry's name, description and schema shape.

```ts
export const someTool = defineTool({
  name: 'snake_case_name',
  description: 'When to call it. Then what comes back.',
  input: z.strictObject({ application_id: z.uuid() }),
  async run(ctx, args) {
    // one existing query function, scoped by ctx.userId
  },
});
```

## Rules

- **C1.** A tool that acts on an application takes `application_id`, and the
  server resolves that application's resume, cover letter and template. Never
  make the agent pass an id Resumix can work out for itself.
- **Inputs are `z.strictObject`**, with snake_case keys. An unknown key is
  then an error that names it, instead of an argument silently dropped.
- **A description says when to call the tool and what comes back** (the
  board's D1). It is all the model reads before choosing a tool.
- **`run` wraps an existing query function, scoped by `ctx.userId`.** The
  data-access rules apply unchanged: nothing here imports `lib/db`, and
  another user's id reads as not found. A tool that needs a new query adds it
  to `lib/queries/`, with a case in `isolation.test.ts`.
- **A tool failure is never a JSON-RPC error.** Return `toolError(text)`, and
  make the text say what to do next. A thrown `NotFoundError` or
  `BadRequestError` becomes `isError` carrying its message. Any other throw
  becomes a generic internal error, so never put the useful part of a failure
  in a plain `Error`.
- **Never add the board's "NOT EXPOSED" tools:** `approve_*` (approval happens
  only in the UI), `update_bullet` and `create_bullet` (suggestions are applied
  in the UI), `update_template`, and any `delete_*`.

## The route and the smoke

`app/api/mcp/route.ts` checks the token (`requireMcpUserId`, D-039) and hands
over to `handleMcpPost`, nothing more. Every handler under `/api/mcp/**`
starts with that check, `GET` included.

`scripts/mcp-smoke.ts` is for the dev stack only (C8, C14). It reads
`MCP_SMOKE_URL`, and refuses a non-loopback host and production's ports.
Never point it at production, and never give it `RESUMIX_MCP_URL`, which is
the name the agent workspace uses for production.
