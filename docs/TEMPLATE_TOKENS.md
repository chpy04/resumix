# Template tokens (contract)

A template is raw LaTeX. Four tokens mark where selected content is spliced in.
Everything else — preamble, macros, header, Education, section titles, list
wrappers — is the template's business and is edited on the Template tab.

## Token syntax

`<<TOKEN_NAME>>`, matched by `/<<([A-Z_]+)>>/g`.

Chosen over `\Macro` (an unsubstituted one is a hard TeX error) and over `%%X%%`
(an unsubstituted one silently vanishes into a comment). `<<` / `>>` survives to
the PDF as visible garbage, which fails loudly but non-fatally.

| Token | Expands to |
|---|---|
| `<<EXPERIENCES>>` | selected experiences, in `sort_order`, each with its selected bullets |
| `<<PROJECTS>>` | selected projects, in `sort_order`, each with its selected bullets |
| `<<SKILLS_TOP>>` | selected skill rows where `top = true`, in `sort_order` |
| `<<SKILLS_BOTTOM>>` | selected skill rows where `top = false`, in `sort_order` |

Unknown tokens are left verbatim and reported as a render warning.
A token may appear zero or more times; every occurrence is substituted.

## Expansions

### `<<EXPERIENCES>>`
Per experience, `\resumeSubheading{title}{dateRange}{company}{location}`:

```latex
\resumeSubheading{Software Engineer}
  {July 2025---December 2025}
  {Via Separations (NExT Consulting)}{Boston, MA}
  \resumeItemListStart{}
  \resumeItem{First bullet}
  \resumeItem{Second bullet}
  \resumeItemListEnd{}
```

If an experience has **zero** selected bullets, the `\resumeItemListStart/End` block
is omitted entirely — an empty `itemize` is a LaTeX error. The heading still renders,
and the renderer emits a warning.

### `<<PROJECTS>>`
Per project, `\resumeProjectHeading{name}{technologies}{dateRange}`:

```latex
\resumeProjectHeading{Mentor Matcher}
  {React, Django}{August 2025}
  \resumeItemListStart{}
  \resumeItem{First bullet}
  \resumeItemListEnd{}
```

Same zero-bullet rule.

### `<<SKILLS_TOP>>` / `<<SKILLS_BOTTOM>>`
Rows joined by ` \\\n`, each row one line, skills comma-separated:

```latex
\textbf{Languages}{: JavaScript, Typescript, Python} \\
\textbf{Frameworks \& Tools}{: Git, Docker, React}
```

No trailing `\\` on the last row (a trailing `\\` before `}` misformats).
Rows with zero selected skills are skipped. If **all** rows in a section are empty
the token expands to the empty string — the template's surrounding
`\begin{itemize}...\item{...}` then produces an empty item, so templates should
guard sections they may leave empty.

## Macros the template must define

The renderer emits these control sequences, so a template is only valid if it
defines them (the seeded default template does):

`\resumeSubheading{#1}{#2}{#3}{#4}` · `\resumeProjectHeading{#1}{#2}{#3}` ·
`\resumeItemListStart` · `\resumeItem{#1}` · `\resumeItemListEnd`

This is a known coupling between renderer and template, accepted for now; see
docs/DECISIONS.md D-004.

## Escaping

Content strings are stored as **raw LaTeX** and are substituted verbatim — bullets
legitimately contain `\textbf{...}`, `\href{...}`, `\$`, `\&`, `\%`. The user is
authoring LaTeX. The renderer does **not** escape content. Compile errors from bad
LaTeX in a bullet surface in the preview's error pane.
