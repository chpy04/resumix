import { expect, type Page } from '@playwright/test';
// pdfjs-dist ships pure-JS text extraction that needs no canvas/DOM, so it
// works fine directly under Node inside a Playwright test (not the browser
// context) — see docs/agents/t10.md for why this is the chosen approach for
// "does the PDF actually contain X" assertions instead of screenshot diffing.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const PASSWORD = 'e2e-password';

/**
 * Logs in if the password gate is showing; no-op if already authenticated.
 *
 * `AuthGate` renders nothing at all until `GET /api/session` answers, so the
 * password field appears a network round trip *after* navigation — sampling
 * `isVisible()` straight away would race it and silently skip the login. We
 * wait for the field instead, and treat a timeout as "already authenticated",
 * which is also what happens under `RESUMIX_AUTH_MODE=dev`, where there is
 * no login screen at all.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/');
  const field = page.getByPlaceholder('Password');

  const gateShowing = await field
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (gateShowing) {
    await field.fill(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(field).toBeHidden();
  }
}

/**
 * Drives the real "new resume" flow from the home page: click the pinned
 * new-resume cell, type a company name into the modal, submit, and wait for
 * the editor to load. Returns the created resume's id (parsed from the URL).
 */
export async function createResumeViaUi(page: Page, companyName: string): Promise<string> {
  await page.goto('/');
  await page
    .getByText(/new resume/i)
    .first()
    .click();
  await page.getByPlaceholder('Company name').fill(companyName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/resume\//, { timeout: 15_000 });
  const match = /\/resume\/([^/?#]+)/.exec(page.url());
  if (!match) throw new Error(`could not parse resume id out of ${page.url()}`);
  await expect(page.getByRole('tab', { name: /content/i })).toBeVisible();
  return match[1]!;
}

/** Waits for the header's combined autosave badge to show "Saved" — i.e.
 *  every in-flight autosave channel has landed. */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Direct API access, used only for setup/lookup (finding real ids by the
// seeded content's stable names) and for verifying server-side truth
// (rendered PDF bytes) that would otherwise require screenshot diffing.
// Every mutation a test cares about proving still goes through the real UI.
// ---------------------------------------------------------------------------

/** The stored token, or null in `dev` auth mode where there isn't one. */
async function getAuthToken(page: Page): Promise<string | null> {
  return page.evaluate(() => window.localStorage.getItem('resumix.token'));
}

interface ApiResult<T> {
  status: number;
  body: T;
}

async function apiRequest<T>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await getAuthToken(page);
  const result = await page.evaluate(
    async ({ path, method, body, token }) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      // Absent in dev auth mode; the server resolves the session itself.
      if (token) headers['x-resumix-token'] = token;
      const res = await fetch(path, {
        method: method ?? 'GET',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text.length > 0 ? JSON.parse(text) : null };
    },
    { path, method: init.method, body: init.body, token },
  );
  const typed = result as ApiResult<T>;
  if (typed.status >= 400) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${typed.status}: ${JSON.stringify(typed.body)}`,
    );
  }
  return typed.body;
}

export interface ResumeDetailLike {
  resume: { id: string; name: string };
  selections: {
    experiences: string[];
    experienceBullets: Record<string, string[]>;
    projects: string[];
    projectBullets: Record<string, string[]>;
    skillRows: string[];
    skills: Record<string, string[]>;
  };
  library: {
    experiences: {
      id: string;
      company: string;
      bullets: { id: string; content: string; isArchived: boolean }[];
    }[];
    projects: {
      id: string;
      name: string;
      bullets: { id: string; content: string; isArchived: boolean }[];
    }[];
    skillRows: { id: string; name: string; skills: { id: string; name: string }[] }[];
  };
}

export function getResumeDetail(page: Page, resumeId: string): Promise<ResumeDetailLike> {
  return apiRequest<ResumeDetailLike>(page, `/api/resumes/${resumeId}`);
}

/** Creates a resume via the real API, bypassing the UI dialog. Used only for
 *  test setup where the creation flow itself isn't what's under test (e.g.
 *  populating the home grid for a search test) — the actual "create clones
 *  Default" behavior is covered end to end by create-clone.spec.ts. */
export async function createResumeViaApi(page: Page, name: string): Promise<string> {
  const created = await apiRequest<{ id: string }>(page, '/api/resumes', {
    method: 'POST',
    body: { name },
  });
  return created.id;
}

/** Finds an experience by its (seeded) company name and returns its id plus
 *  the id of its Nth bullet (0-indexed) — a stable way to address specific
 *  seeded content without hardcoding UUIDs. */
export function findExperienceBullet(
  detail: ResumeDetailLike,
  company: string,
  bulletIndex: number,
): { experienceId: string; bulletId: string; content: string } {
  const experience = detail.library.experiences.find((e) => e.company === company);
  if (!experience) throw new Error(`no experience found for company "${company}"`);
  const bullet = experience.bullets[bulletIndex];
  if (!bullet) throw new Error(`experience "${company}" has no bullet at index ${bulletIndex}`);
  return { experienceId: experience.id, bulletId: bullet.id, content: bullet.content };
}

export function findExperienceId(detail: ResumeDetailLike, company: string): string {
  const experience = detail.library.experiences.find((e) => e.company === company);
  if (!experience) throw new Error(`no experience found for company "${company}"`);
  return experience.id;
}

interface RenderResultLike {
  ok: boolean;
  pdfBase64?: string;
  pages: number | null;
  errors: string[];
}

/** Calls the real (never-persisting) render endpoint and returns the decoded
 *  PDF text — the most reliable way to assert "X is/isn't on the page"
 *  without pixel-diffing a canvas. */
export async function renderResumeText(page: Page, resumeId: string): Promise<string> {
  const result = await apiRequest<RenderResultLike>(page, `/api/resumes/${resumeId}/render`, {
    method: 'POST',
    body: {},
  });
  if (!result.ok || !result.pdfBase64) {
    throw new Error(`render failed for resume ${resumeId}: ${result.errors.join('; ')}`);
  }
  return extractPdfText(result.pdfBase64);
}

/** Decodes a base64 PDF (as returned by /render or read off disk from a
 *  browser download) into its plain text content, page by page. */
export async function extractPdfText(base64: string): Promise<string> {
  const bytes = Buffer.from(base64, 'base64');
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
  try {
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
    }
    return text;
  } finally {
    await doc.destroy();
  }
}

/**
 * Simulates an `@dnd-kit` pointer drag: press on the source row's drag
 * handle, move past the 4px activation-distance constraint, hover over the
 * target row, and release. `@dnd-kit`'s `PointerSensor` is the only sensor
 * registered in this app (no `KeyboardSensor` — see docs/agents/t10.md), so
 * a real mouse gesture is the only way to drive it end to end; Playwright's
 * `mouse` API dispatches real pointer events in Chromium, which is exactly
 * what `PointerSensor` listens for.
 */
export async function dragRowAbove(page: Page, sourceId: string, targetId: string): Promise<void> {
  // `SortableRow` (data-testid="drag-row-<id>") wraps both the drag handle
  // and the row's own content (e.g. "content-row-<id>") as siblings, so the
  // handle has to be found from the shared `SortableRow` wrapper, not from
  // inside the content row itself.
  const sourceHandle = page
    .locator(`[data-testid="drag-row-${sourceId}"]`)
    .getByRole('button', { name: 'Drag to reorder' });
  const targetRow = page.locator(`[data-testid="drag-row-${targetId}"]`);

  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error(`could not find bounding boxes for drag (${sourceId} -> ${targetId})`);
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + 4; // near the top edge of the target row, to land above it

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Small moves first to clear the PointerSensor's 4px activation distance.
  await page.mouse.move(startX, startY + 8, { steps: 5 });
  await page.mouse.move(startX, startY + 16, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.move(endX, endY, { steps: 2 });
  await page.mouse.up();
}
