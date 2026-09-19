---
paths: 'app/api/**'
---

# Route handlers

`docs/API.md` is the contract, not a description. Code and doc disagreeing is
a bug in one of them; fix it deliberately and in the same commit.

## The three-layer split

A handler does four things and no more: await `params`, parse the body,
call one query function, shape the response. Anything else belongs a layer
down.

1. **Validation** — a zod schema in `lib/validation.ts`.
2. **Data access** — a function in `lib/queries/<resource>.ts`. This is the
   only layer allowed to import `lib/db` (ESLint enforces it).
3. **Handler** — `app/api/<resource>/route.ts`, wrapped in `withApiErrors`.

```ts
import { parseJsonBody, type RouteContext, withApiErrors } from '@/lib/http';

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  return withApiErrors(async () => {
    const { id } = await params;
    const body = await parseJsonBody(request, patchExperienceSchema);
    return Response.json(await updateExperience(id, body));
  });
}
```

- `RouteContext` is imported from `lib/http.ts` — never redeclared locally.
  `next build` type-checks handler signatures against Next's own generated
  types, so the shape is not ours to vary.
- Never `try/catch` for HTTP status. Throw `NotFoundError` / `BadRequestError`
  from `lib/queries/errors.ts`; `withApiErrors` maps them to 404 / 400 and
  everything else to a logged 500 with a generic body.
- `201` on create, `204` with a null body on delete, `200` otherwise.
- Unused handler parameters take a `_` prefix (`_request`).

## Auth is already handled

`middleware.ts` guards every `/api/*` route except `/api/auth`. Do not check
the token inside a handler.

## Two things that are not HTTP errors

- **A LaTeX compile failure** is `200 { ok: false, errors, warnings, log }`.
  The template being broken is a normal state of the editor, not a server
  fault. Never turn it into a 4xx/5xx.
- **Archiving.** There are no DELETE endpoints for content — only
  `isArchived` on a PATCH. A resume must keep rendering content that has
  since been retired (D-011). `DELETE /api/resumes/:id` is the one exception,
  and it 400s on the default resume.

## Adding an endpoint

Validation schema → query function → handler → update `docs/API.md` in the
same commit. Then `npm run verify`.
