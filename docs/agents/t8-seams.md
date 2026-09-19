# T8 → T9 handoff: template tab + PDF preview pane

T8 built the editor page shell (`app/resume/[id]/page.tsx` → `components/editor/ResumeEditor.tsx`),
the full Content tab, and the autosave/selection plumbing. T9 adds the Template tab's real body and
the live PDF preview. Two files are placeholders by design — replace them, don't extend them.

## 1. The preview pane: `components/editor/PreviewPanePlaceholder.tsx`

Mounted once, in exactly one place, regardless of which tab is active:

```tsx
// components/editor/ResumeEditor.tsx, inside the two-pane row
<div style={{ width: `${100 - splitPercent}%` }} className="min-h-0 overflow-hidden p-3">
  <PreviewPanePlaceholder
    resumeId={resumeId}
    templateName={state.template.name}
    hasSavedPdf={state.latestPdf !== null}
  />
</div>
```

Replace the component (keep the file path/name or update the one import site in `ResumeEditor.tsx`
if you rename it). It should call `POST /api/resumes/:id/render` (see `docs/API.md`) — **not**
`/pdf`, which persists a snapshot; the live preview must never write to the database. `render`
accepts an optional `templateOverride` specifically so the Template tab can preview unsaved LaTeX
before it's been `PATCH`ed.

What the real component will need that the placeholder doesn't take yet:
- The **current template content** (`state.template.content`, or an unsaved draft string from the
  Template tab — you'll likely lift a `draftTemplateContent: string | null` into `ResumeEditor` the
  same way `resumeName`/`library` are lifted, and pass it down alongside `template`).
- The **current selections** (`selections`, already in scope in `ResumeEditor`) — render needs to
  re-run whenever content or order changes, not just when the template changes. You'll want your
  own debounce here (rendering is expensive); reuse `lib/editor/autosave.ts`'s `createAutosave` if
  a debounced "re-render on change" queue is useful — it's generic over the payload type.
- A loading/error state for the render call itself (compile errors are `200 { ok: false, errors,
  warnings }`, not thrown — see `docs/agents/t6.md` Deviations #2, and don't confuse this with the
  `ApiError` thrown for actual HTTP failures).

`saveResumePdf` (`POST /pdf`) and `downloadResumePdf` (`GET /pdf`) are already wired to the header's
"Save PDF" button in `EditorHeader.tsx` / `ResumeEditor.tsx` — that flow is done and not part of
your scope; the preview pane is purely the *live, unsaved* view.

## 2. The Template tab body: `components/editor/TemplateTabPlaceholder.tsx`

Mounted conditionally in `ResumeEditor.tsx`:

```tsx
{tab === 'content' ? (
  <ContentPane library={state.library} selections={selections} callbacks={contentCallbacks} />
) : (
  <TemplateTabPlaceholder template={state.template} />
)}
```

Replace this branch with your real editor (a textarea or code editor bound to the template's LaTeX).
Rules to keep, carried over from the content-tab pattern already in this file:
- Editing the template is a **global** change (`PATCH /api/templates/:id`, already in
  `lib/api-client.ts` as `updateTemplate`) — it is not scoped to this resume any more than editing a
  bullet is. Reuse the `GlobalEditBadge` atom from `components/editor/atoms.tsx` on the editor
  surface, same as every content field does, so the "this changes everywhere" rule stays visually
  consistent across tabs.
- Autosave the same way content fields do: `500ms` debounce, coalescing, routed through
  `useAutosaveRegistry` (already instantiated in `ResumeEditor` as `autosave` — call
  `autosave.getController('template:content', save, 500)` from inside `ResumeEditor` and pass the
  resulting `schedule` function down, exactly like `onExperienceFieldChange` etc. do). This keeps
  the header's single combined `SaveStatusBadge` honest about template edits too, for free.
- A resume can swap templates (`PATCH /api/resumes/:id { templateId }`) — out of scope for T8, but
  if the Template tab grows a "switch template" affordance, `updateResume` is already exported from
  `lib/api-client.ts`.

## Tab state and props already lifted for you

`EditorHeader.tsx` owns the tab buttons but not the state — `tab`/`setTab` live in `ResumeEditor`
(`useState<EditorTab>('content')`, `EditorTab = 'content' | 'template'`, exported from
`EditorHeader.tsx`). You shouldn't need to touch `EditorHeader.tsx` at all unless the Template tab
needs its own header affordance (e.g. a "switch template" dropdown) — if so, thread it through as a
new prop rather than special-casing `tab === 'template'` inside `EditorHeader`.

## What NOT to touch

- `components/editor/ContentPane.tsx`, `ItemBulletSection.tsx`, `SkillsSection.tsx`,
  `SortableList.tsx`, `SortableRow.tsx`, `atoms.tsx`, `useAutosaveRegistry.ts` — the Content tab is
  done; T9 is additive.
- `lib/editor/selections-reducer.ts`, `lib/editor/visibility.ts`, `lib/editor/autosave.ts` — pure,
  unit-tested, and not selections-specific in the autosave/visibility cases (both are already
  generic enough to reuse for template-content autosave and, if ever needed, template archival
  visibility).
- Do not create anything under `components/preview/**` or `components/template/**` per the original
  task split — everything you add stays under `components/editor/**`, same as T8's files, so the
  page shell's import graph stays flat.
