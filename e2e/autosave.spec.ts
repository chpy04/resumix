import { expect, test, type Page } from '@playwright/test';
import {
  createResumeViaUi,
  findExperienceBullet,
  findExperienceId,
  getResumeDetail,
  login,
  type ResumeDetailLike,
} from './support';

/**
 * spec.md: "Saves should happen automatically." The editor has no save
 * button, so autosave firing — and firing the right number of times — is the
 * whole persistence story.
 *
 * The other specs exercise autosave incidentally, on the way to asserting
 * something else: `global-edit` proves a bullet edit reaches every resume,
 * `selection-scope` and `reorder` prove a selection change reaches the
 * server. All three would still pass if the editor issued one request per
 * keystroke, or issued requests nobody asked for. This file asserts the
 * request traffic itself, which is what pins the wiring in `ResumeEditor` to
 * the queue semantics in `lib/editor/autosave.ts`:
 *
 * - `useAutosaveRegistry` caches one `AutosaveController` per key in a ref and
 *   reuses it for the life of the page, refreshing only the closure it calls.
 *   Anything that makes the controller per-*render* instead of per-*key* —
 *   holding the cache in state, keying it on something that varies, or
 *   dropping the registry and calling `createAutosave` straight from the
 *   handler — gives every keystroke its own empty debounce timer. `coalesces
 *   a burst of keystrokes` is what fails then, and it fails loudly: disabling
 *   the cache turns its one expected request into eleven.
 * - Each key gets its *own* queue, so two fields edited together must not
 *   share one in-flight save and clobber each other. That is `two fields
 *   edited together`.
 * - Nothing schedules a save that the user did not ask for. That is `saves
 *   nothing on load`.
 *
 * None of this is what `react-hooks/exhaustive-deps` itself checks — the rule
 * flagged `getController` as unverifiable, not as wrong, and the fix for it
 * was deliberately behaviour-free. These tests are the behavioural floor that
 * was missing underneath it: they say what the editor's save traffic must look
 * like, so the next change to this wiring has something to fail against.
 */

/**
 * Reads one bullet's text back out of a fresh library payload, **by id**.
 *
 * Addressing it by position instead would be wrong here, and quietly so.
 * `lib/queries/library.ts` orders bullets by `created_at` alone, and the seed
 * writes every bullet of an experience in one transaction, so they all share
 * one timestamp — the ordering is a total tie that Postgres is free to break
 * differently on each scan, and editing a row is exactly what makes it do so.
 * An index-based assertion here therefore compares the edit against whichever
 * *other* bullet happened to surface first. Every existing spec that checks
 * bullet content (`global-edit`) addresses by id for this reason.
 */
function bulletContent(detail: ResumeDetailLike, bulletId: string): string {
  for (const experience of detail.library.experiences) {
    const bullet = experience.bullets.find((b) => b.id === bulletId);
    if (bullet) return bullet.content;
  }
  throw new Error(`no bullet ${bulletId} in the library`);
}

/** A `PATCH /api/experience-bullets/<id>`-shaped record of one request. */
type SaveRecord = string;

/**
 * Records every *persisting* API mutation the page makes: any non-GET request
 * under `/api/`, except `/render`.
 *
 * `/render` is excluded deliberately rather than incidentally. `PreviewPane`
 * POSTs the current in-memory state to `POST /api/resumes/:id/render` on its
 * own 600ms debounce to redraw the live preview, and that endpoint persists
 * nothing — it is `/render`, never `/pdf`, which is the one that snapshots
 * bytes into `resume_pdf`. Counting it would turn every assertion here into a
 * measurement of the preview's debounce rather than of autosave.
 */
function recordSaves(page: Page): { all: () => SaveRecord[]; reset: () => void } {
  let seen: SaveRecord[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET') return;
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/api/')) return;
    if (pathname.endsWith('/render')) return;
    seen.push(`${request.method()} ${pathname}`);
  });
  return {
    all: () => [...seen],
    reset: () => {
      seen = [];
    },
  };
}

/**
 * Longer than both debounces in play (500ms for text autosave, 600ms for the
 * preview) plus room for the request itself. A negative assertion needs a
 * settling window — there is no event that means "nothing is going to
 * happen" — so every test that asserts an absence also fires a real save
 * afterwards as a positive control, proving the recorder was live.
 */
const QUIET_MS = 1500;

test('autosave saves nothing on load, or on switching tabs', async ({ page }) => {
  await login(page);
  const resumeId = await createResumeViaUi(page, `T11 Autosave Quiet ${Date.now()}`);

  // Let the initial load and the preview's first compile finish before
  // recording, so what follows is only traffic the tab-switching caused.
  await expect(
    page.getByRole('checkbox', { name: 'Include Unicode on this resume' }),
  ).toBeVisible();
  await page.waitForTimeout(QUIET_MS);

  const saves = recordSaves(page);

  await page.getByRole('tab', { name: /template/i }).click();
  await expect(page.locator('textarea').first()).toBeVisible();
  await page.getByRole('tab', { name: /content/i }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Include Unicode on this resume' }),
  ).toBeVisible();
  await page.waitForTimeout(QUIET_MS);

  expect(saves.all()).toEqual([]);

  // Positive control: the recorder is watching, and a real edit does show up.
  // Without this, a broken recorder would make the assertion above pass.
  await page.getByRole('checkbox', { name: 'Include Unicode on this resume' }).click();
  await expect.poll(saves.all).toEqual([`PUT /api/resumes/${resumeId}/selections`]);
});

test('autosave coalesces a burst of keystrokes into one request', async ({ page }) => {
  await login(page);
  const resumeId = await createResumeViaUi(page, `T11 Autosave Burst ${Date.now()}`);

  const detail = await getResumeDetail(page, resumeId);
  const { bulletId } = findExperienceBullet(detail, 'Northeastern Electric Racing', 0);

  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  const textarea = page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea');

  // A single-line baseline, so `End` below reliably parks the cursor after it.
  const baseline = `T11 burst ${Date.now()}`;
  await textarea.fill(baseline);

  const saves = recordSaves(page);
  await expect.poll(saves.all).toEqual([`PATCH /api/experience-bullets/${bulletId}`]);
  saves.reset();

  // Eleven keystrokes at 15ms apart — ~165ms of typing, comfortably inside
  // the 500ms debounce, so the correct behaviour is exactly one request.
  // A per-render controller would produce eleven.
  const suffix = ' abcdefghij';
  await textarea.press('End');
  await textarea.pressSequentially(suffix, { delay: 15 });

  await expect.poll(saves.all).toEqual([`PATCH /api/experience-bullets/${bulletId}`]);
  // …and still exactly one after everything has had time to land.
  await page.waitForTimeout(QUIET_MS);
  expect(saves.all()).toEqual([`PATCH /api/experience-bullets/${bulletId}`]);

  await expect(textarea).toHaveValue(baseline + suffix);

  // The one request carried the *last* value, not the first — coalescing
  // replaces the pending value rather than dropping the later keystrokes.
  const after = await getResumeDetail(page, resumeId);
  expect(bulletContent(after, bulletId)).toBe(baseline + suffix);
});

test('autosave gives two fields edited together their own queues', async ({ page }) => {
  await login(page);
  const resumeId = await createResumeViaUi(page, `T11 Autosave Channels ${Date.now()}`);

  const detail = await getResumeDetail(page, resumeId);
  const first = findExperienceBullet(detail, 'Northeastern Electric Racing', 0);
  const second = findExperienceBullet(detail, 'Northeastern Electric Racing', 1);
  const unicodeId = findExperienceId(detail, 'Unicode');

  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  const firstArea = page
    .locator(`[data-testid="bullet-row-${first.bulletId}"]`)
    .locator('textarea');
  const secondArea = page
    .locator(`[data-testid="bullet-row-${second.bulletId}"]`)
    .locator('textarea');
  await expect(firstArea).toBeVisible();

  const stamp = Date.now();
  const firstText = `T11 channel one ${stamp}`;
  const secondText = `T11 channel two ${stamp}`;

  const saves = recordSaves(page);

  // Two text edits and one selection toggle, back to back and well inside the
  // 500ms debounce. Three distinct keys, so three requests — and crucially
  // neither bullet's value may be lost to the other's in-flight save.
  await firstArea.fill(firstText);
  await secondArea.fill(secondText);
  await page.getByRole('checkbox', { name: 'Include Unicode on this resume' }).click();

  await expect
    .poll(() => saves.all().slice().sort())
    .toEqual(
      [
        `PATCH /api/experience-bullets/${first.bulletId}`,
        `PATCH /api/experience-bullets/${second.bulletId}`,
        `PUT /api/resumes/${resumeId}/selections`,
      ].sort(),
    );
  await page.waitForTimeout(QUIET_MS);
  expect(saves.all()).toHaveLength(3);

  // All three landed, in full. A shared queue would leave one of the bullets
  // holding its original seeded text.
  const after = await getResumeDetail(page, resumeId);
  expect(bulletContent(after, first.bulletId)).toBe(firstText);
  expect(bulletContent(after, second.bulletId)).toBe(secondText);
  expect(after.selections.experiences).not.toContain(unicodeId);
});

test('autosave survives a reload — both the debounced and the immediate channel', async ({
  page,
}) => {
  await login(page);
  const resumeId = await createResumeViaUi(page, `T11 Autosave Persist ${Date.now()}`);

  const detail = await getResumeDetail(page, resumeId);
  const { bulletId } = findExperienceBullet(detail, 'Northeastern Electric Racing', 0);

  // The 500ms channel: a text edit.
  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  const textarea = page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea');
  const edited = `T11 persisted through a reload ${Date.now()}`;
  await textarea.fill(edited);

  // The 0ms channel: a selection toggle.
  const toggle = page.getByRole('checkbox', { name: 'Include Unicode on this resume' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // No explicit save, and no waiting on the badge: reload once the server
  // itself agrees, which is the only thing a reload can show.
  await expect
    .poll(async () => {
      const current = await getResumeDetail(page, resumeId);
      return bulletContent(current, bulletId);
    })
    .toBe(edited);

  await page.reload();
  await expect(page.getByRole('tab', { name: /content/i })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Northeastern Electric Racing bullets' }).click();
  await expect(
    page.locator(`[data-testid="bullet-row-${bulletId}"]`).locator('textarea'),
  ).toHaveValue(edited);
  await expect(
    page.getByRole('checkbox', { name: 'Include Unicode on this resume' }),
  ).toHaveAttribute('aria-checked', 'false');
});
