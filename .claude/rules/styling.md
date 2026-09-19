---
paths:
  - 'components/**'
  - 'app/**/*.tsx'
  - 'app/globals.css'
---

# Styling

Tailwind v4. The entire palette is the `@theme` block in `app/globals.css`;
there is no other design system and no CSS modules.

## Use the generated utilities, nothing else

`@theme { --color-ink-dim: … }` generates `text-ink-dim`, `bg-ink-dim`,
`border-ink-dim`. Use those.

```tsx
className = 'border-line bg-surface text-ink-dim'; // yes
className = 'border-[var(--color-line)]'; // no — 230 of these were removed
className = 'text-red-400'; // no — use text-danger
```

Two things are out:

- **Arbitrary values** wrapping a theme variable (`text-[var(--color-ink)]`).
  Longer, and it hides that a token exists.
- **Raw palette shades** (`text-red-400`, `bg-red-950`). They drift: the same
  error banner was three different reds across three files. Error and success
  states use the `danger`/`success` tokens, which alias Tailwind's own scale
  rather than hardcoding hex.

Opacity modifiers on tokens are fine and encouraged: `bg-danger-surface/30`,
`hover:bg-danger-line/40`.

## Adding a colour

Add a named token to `@theme` in `app/globals.css` describing its _role_
(`--color-danger-line`), not its appearance (`--color-dark-red`). A colour
used once still gets a token — that is how the existing drift started.

## Error surfaces

The established recipe, used verbatim in four places:

```tsx
<div className="rounded-lg border border-danger-line/50 bg-danger-surface/30 p-6 text-sm text-danger-ink">
  <p className="font-medium">Couldn&apos;t load your resumes.</p>
  <p className="mt-1 text-danger/80">{message}</p>
</div>
```

Inline field errors are plain `text-danger`.
