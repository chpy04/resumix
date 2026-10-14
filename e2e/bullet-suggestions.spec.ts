import { expect, test, type Page, type Request } from '@playwright/test';
import {
  createApplicationViaApi,
  createExperienceViaApi,
  getApplicationDetail,
  getDefaultResumeId,
  getResumeDetail,
  insertBulletSuggestions,
  login,
  renderResumeText,
  setApplicationPipelineState,
  setSelectionsViaApi,
} from './support';

/**
 * The agent's bullet suggestions in review step 1 (D-045): an edit on its
 * bullet's row in yellow, an addition in green in the slot it prints in,
 * both already in the preview. Apply rewrites the bullet in the library, Add
 * bullet creates and selects one, and Approve resume waits for both.
 *
 * The suggestions are written straight to the database: only the agent
 * makes them, over MCP, and only while it is still proposing. They sit on an
 * experience this test creates, since Apply edits the library for every
 * resume and other specs read the seeded bullets.
 */

/** Every character `escapeLatex` replaces, so the PDF proves each prints. */
const SPECIALS = 'a<b>c | 50% ~x^2_y {z} \\ $5 & #1';

/** What pdfjs reads of SPECIALS once the spaces between font runs are gone.
 *  OT1 sets `~` and `^` as the accents ˜ and ˆ, and `_` as a drawn rule,
 *  which has no text to read: hence `2y`. */
const SPECIALS_IN_PDF = 'a<b>c|50%˜xˆ2y{z}\\$5&#1';

/** `escapeLatex(SPECIALS)`: what Add bullet stores. */
const SPECIALS_ESCAPED =
  'a\\textless{}b\\textgreater{}c \\textbar{} 50\\% \\textasciitilde{}x\\textasciicircum{}2\\_y ' +
  '\\{z\\} \\textbackslash{} \\$5 \\& \\#1';

function flat(text: string): string {
  return text.replace(/\s+/g, '');
}

function resolved(page: Page, suggestionId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/bullet-suggestions/${suggestionId}/resolve`),
  );
}

test('suggestions: inline cards, in the preview, then Apply and Add', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const defaultResumeId = await getDefaultResumeId(page);
  const appId = await createApplicationViaApi(page, {
    company: `T-Suggest Google ${stamp}`,
    createResumeFrom: defaultResumeId,
  });
  const { resumeId } = await getApplicationDetail(page, appId);
  if (!resumeId) throw new Error('the application has no resume');

  const {
    experienceId,
    bulletIds: [boldId, plainId, leftOutId],
  } = await createExperienceViaApi(page, `T-Suggest Acme ${stamp}`, [
    `Cut p99 latency \\textbf{40\\%} ${stamp}`,
    `Shipped tooling ${stamp}`,
    `Led a migration ${stamp}`,
  ]);
  if (!boldId || !plainId || !leftOutId) throw new Error('the bullets were not all created');
  const selections = {
    experiences: [experienceId],
    experienceBullets: { [experienceId]: [boldId, plainId] },
    projects: [],
    projectBullets: {},
    skillRows: [],
    skills: {},
  };
  await setSelectionsViaApi(page, resumeId, selections);
  await setApplicationPipelineState(appId, {
    status: 'needs_review',
    proposedSelection: selections,
  });

  const editText = `Cut p99 latency 40% across 3 services ${stamp}`;
  const addText = `Glyphs ${SPECIALS} ${stamp}`;
  const [editId, addId] = await insertBulletSuggestions(appId, [
    { kind: 'edit', bulletId: boldId, proposedText: editText, rationale: 'the JD stresses scale' },
    {
      kind: 'add',
      parentId: experienceId,
      position: 1,
      proposedText: addText,
      rationale: 'the JD asks for ops work',
    },
  ]);
  if (!editId || !addId) throw new Error('the suggestions were not both added');

  // The review preview has them, in their places; a plain render does not.
  const overlaid = flat(await renderResumeText(page, resumeId, appId));
  const plain = flat(await renderResumeText(page, resumeId));
  const at = (text: string) => overlaid.indexOf(flat(text));
  expect(at(editText)).toBeGreaterThan(-1);
  expect(overlaid).toContain(`Glyphs${SPECIALS_IN_PDF}${stamp}`);
  expect(at(editText)).toBeLessThan(at(`Glyphs`));
  expect(at('Glyphs')).toBeLessThan(at(`Shipped tooling ${stamp}`));
  expect(plain).not.toContain(flat(editText));
  expect(plain).not.toContain('Glyphs');
  expect(plain).toContain(flat(`Cut p99 latency 40% ${stamp}`));

  // Every load of this resume the page starts, as in review.spec.ts: the
  // first click waits for them, and so does each one after a resolve, which
  // re-reads the resume.
  let loadsInFlight = 0;
  const isLoad = (request: Request) =>
    request.method() === 'GET' && new URL(request.url()).pathname === `/api/resumes/${resumeId}`;
  page.on('request', (request) => {
    if (isLoad(request)) loadsInFlight++;
  });
  const settled = (request: Request) => {
    if (isLoad(request)) loadsInFlight--;
  };
  page.on('requestfinished', settled);
  page.on('requestfailed', settled);

  await page.goto(`/applications/${appId}/review`);

  // The edit is on its bullet's row, with now, was and why, and a warning
  // that applying drops the bold.
  const boldRow = page.getByTestId(`bullet-row-${boldId}`);
  const editCard = boldRow.getByTestId(`suggestion-card-${editId}`);
  await expect(editCard).toContainText('Suggested edit');
  await expect(editCard.getByRole('textbox', { name: 'Suggested text' })).toHaveValue(editText);
  await expect(editCard).toContainText(`was Cut p99 latency 40% ${stamp}`);
  await expect(editCard).toContainText('why the JD stresses scale');
  await expect(editCard).toContainText('its formatting is not kept');

  // The addition is its own card, between the two selected bullets.
  const addCard = page.getByTestId(`suggestion-card-${addId}`);
  await expect(addCard).toContainText('+ Suggested new bullet');
  await expect(addCard.getByRole('textbox', { name: 'Suggested text' })).toHaveValue(addText);
  await expect(addCard).toContainText('why: the JD asks for ops work');
  const y = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.y ?? NaN;
  expect(await y(`suggestion-card-${addId}`)).toBeGreaterThan(await y(`bullet-row-${boldId}`));
  expect(await y(`suggestion-card-${addId}`)).toBeLessThan(await y(`bullet-row-${plainId}`));

  // Approving the resume waits for both.
  const approveResume = page.getByRole('button', { name: 'Approve resume' });
  await expect(approveResume).toBeDisabled();
  await expect(page.getByText('Apply or reject the 2 bullet suggestions first.')).toBeVisible();
  await expect.poll(() => loadsInFlight).toBe(0);

  // Apply to bullet: the library bullet now reads the escaped text, here
  // and through the API, and the selection is as it was.
  let response = resolved(page, editId);
  await editCard.getByRole('button', { name: 'Apply to bullet' }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByTestId(`suggestion-card-${editId}`)).toHaveCount(0);
  await expect(boldRow.locator('textarea')).toHaveValue(
    `Cut p99 latency 40\\% across 3 services ${stamp}`,
  );
  await expect.poll(() => loadsInFlight).toBe(0);
  let detail = await getResumeDetail(page, resumeId);
  const bullets = () =>
    detail.library.experiences.find((e) => e.id === experienceId)?.bullets ?? [];
  expect(bullets().find((b) => b.id === boldId)?.content).toBe(
    `Cut p99 latency 40\\% across 3 services ${stamp}`,
  );
  expect(detail.selections.experienceBullets[experienceId]).toEqual([boldId, plainId]);
  await expect(page.getByText('Apply or reject the bullet suggestion first.')).toBeVisible();

  // Add bullet: a new bullet under the experience, selected in its slot.
  response = resolved(page, addId);
  await addCard.getByRole('button', { name: 'Add bullet' }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByTestId(`suggestion-card-${addId}`)).toHaveCount(0);
  await expect.poll(() => loadsInFlight).toBe(0);
  detail = await getResumeDetail(page, resumeId);
  const added = bullets().find((b) => b.content === `Glyphs ${SPECIALS_ESCAPED} ${stamp}`);
  expect(added).toBeTruthy();
  expect(detail.selections.experienceBullets[experienceId]).toEqual([boldId, added?.id, plainId]);

  // Both resolved: the resume is approved, and the Approve step says what
  // became of them.
  await expect(approveResume).toBeEnabled();
  await approveResume.click();
  await expect(page.getByTestId('review-step-resume')).toHaveText('1 Resume – ok');
  await page.getByTestId('review-step-approve').click();
  await expect(page.getByTestId('approve-row-suggestions')).toContainText(
    'Bullet suggestions · 2 applied',
  );
  const after = await getApplicationDetail(page, appId);
  expect(after.bulletSuggestions.map((s) => [s.id, s.status])).toEqual([
    [editId, 'applied'],
    [addId, 'applied'],
  ]);

  // What is stored now prints as the preview did, specials included.
  expect(flat(await renderResumeText(page, resumeId))).toContain(
    `Glyphs${SPECIALS_IN_PDF}${stamp}`,
  );
});
