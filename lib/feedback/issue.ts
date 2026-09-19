/**
 * Pure formatting for the GitHub issue a piece of in-app feedback becomes.
 * No network, no env, no `File` — everything here is a plain function over
 * plain data so it can be unit-tested (`issue.test.ts`) without a token.
 *
 * The output is read by two audiences: a human skimming the issue list, and
 * an AI agent that pulls issues down and fixes them. That's why the type and
 * the route are the first two lines of the body rather than buried in a
 * details block — an agent shouldn't have to parse prose to learn which page
 * broke.
 */

import { describeUserAgent } from './user-agent.ts';

export type FeedbackKind = 'bug' | 'feature';

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['bug', 'feature'];

/** Everything needed to render an issue. `screenshotUrl` is already-uploaded. */
export interface FeedbackIssueInput {
  kind: FeedbackKind;
  description: string;
  url: string;
  viewport?: string | null;
  userAgent?: string | null;
  screenshotUrl?: string | null;
  /** Set when a screenshot was attached but its upload failed; the report is
   *  still worth filing, so the body says so rather than losing it. */
  screenshotError?: string | null;
  submittedAt?: Date;
}

/** The repo's own label vocabulary. `feedback` marks the widget as the source. */
const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'bug', feature: 'enhancement' };
const KIND_TITLE: Record<FeedbackKind, string> = { bug: 'Bug', feature: 'Feature' };

const TITLE_SUMMARY_MAX = 72;

export function issueLabels(kind: FeedbackKind): string[] {
  return ['feedback', KIND_LABEL[kind]];
}

/**
 * `[Bug] first line of the description`, truncated on a word boundary.
 * Falls back to a generic title if the description is only whitespace —
 * the API rejects that case first, but a title must never be empty.
 */
export function issueTitle(kind: FeedbackKind, description: string): string {
  const firstLine = description
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const summary = firstLine ? truncateOnWord(collapseWhitespace(firstLine), TITLE_SUMMARY_MAX) : '';
  return summary.length > 0
    ? `[${KIND_TITLE[kind]}] ${summary}`
    : `[${KIND_TITLE[kind]}] In-app feedback`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateOnWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, max - 1);
  const lastSpace = head.lastIndexOf(' ');
  // Only back up to a word boundary if that doesn't gut the summary.
  const cut = lastSpace > max / 2 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

/**
 * Markdown body. The description is inserted verbatim — this is a
 * single-user app whose only author is the repo owner, and feedback
 * legitimately contains markdown and LaTeX snippets (same reasoning as
 * D-008: don't escape content the author meant literally).
 *
 * The submitted URL is split: the **route** leads the body, because that is
 * the part that names a page in this codebase, and the **origin** goes in
 * Environment next to the browser, because "was this prod or a laptop" is
 * context about the report rather than about the page. Two reports on the
 * same page then read as the same page.
 */
export function issueBody(input: FeedbackIssueInput): string {
  const submittedAt = input.submittedAt ?? new Date();
  const sections: string[] = [
    `**Type:** ${KIND_TITLE[input.kind]} ${input.kind === 'bug' ? 'report' : 'request'}`,
    `**Page:** ${codeSpan(routeOf(input.url))}`,
    '',
    '### Description',
    '',
    input.description.trim(),
  ];

  if (input.screenshotUrl) {
    sections.push('', '### Screenshot', '', `![screenshot](${encodeParens(input.screenshotUrl)})`);
  } else if (input.screenshotError) {
    sections.push(
      '',
      '### Screenshot',
      '',
      `_A screenshot was attached but could not be uploaded: ${collapseWhitespace(input.screenshotError)}_`,
    );
  }

  sections.push(
    '',
    '<details>',
    '<summary>Environment</summary>',
    '',
    `- Origin: ${originOf(input.url)}`,
    `- Browser: ${describeUserAgent(input.userAgent)}`,
    `- Viewport: ${input.viewport ?? 'unknown'}`,
    `- Submitted: ${submittedAt.toISOString()}`,
    `- User agent: ${codeSpan(input.userAgent ?? 'unknown')}`,
    '',
    '</details>',
    '',
    '---',
    '',
    '_Filed from the in-app feedback widget._',
  );

  return sections.join('\n');
}

/**
 * `https://resumix.app/resume/abc?tab=template` → `/resume/abc?tab=template`.
 * An unparseable URL is passed through rather than dropped — a malformed
 * value is still evidence, and the raw field is not worth losing over it.
 */
function routeOf(url: string): string {
  const parsed = parseUrl(url);
  return parsed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
}

function originOf(url: string): string {
  return parseUrl(url)?.origin ?? 'unknown';
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Backticks are stripped, not escaped: nothing that lands in one of these
 *  spans (a route, a UA string) can legitimately contain one, and an
 *  unbalanced backtick would break the rest of the line. */
function codeSpan(value: string): string {
  return `\`${value.replace(/`/g, '')}\``;
}

function encodeParens(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// ---------------------------------------------------------------------------
// Screenshot naming
// ---------------------------------------------------------------------------

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const ALLOWED_SCREENSHOT_TYPES: readonly string[] = Object.keys(EXTENSION_BY_MIME);

/** `null` for anything GitHub wouldn't render inline in an issue body. */
export function extensionForMimeType(mimeType: string): string | null {
  return EXTENSION_BY_MIME[mimeType.toLowerCase().split(';')[0]!.trim()] ?? null;
}

/**
 * Path of the screenshot on the assets branch:
 * `screenshots/2026/09/2026-09-19T15-04-05-123Z-<id>.png`. Date-partitioned
 * so the branch stays browsable after a few hundred reports, and suffixed
 * with a random id so two reports filed in the same millisecond can't
 * collide (a collision would overwrite an older issue's screenshot).
 */
export function screenshotPath(extension: string, at: Date, id: string): string {
  const iso = at.toISOString();
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const stamp = iso.replace(/[:.]/g, '-');
  return `screenshots/${year}/${month}/${stamp}-${id.slice(0, 8)}.${extension}`;
}
