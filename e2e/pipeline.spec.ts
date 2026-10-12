import { expect, test, type Page } from '@playwright/test';
import {
  createApplicationViaApi,
  dragCardOnto,
  login,
  setApplicationPipelineState,
} from './support';

/**
 * The review flow's three columns: Proposing, Needs review and Ready.
 *
 * Only the flow puts an application there, so the board must show them but
 * never accept a drop into them, while still letting a card leave them for
 * the manual statuses — Ready to Applied being the one that matters (C3,
 * D-041). Flow states are set up by writing the row directly, because the
 * API refuses them by design.
 */

/** The `data-testid`s of the cards in one column, top to bottom. */
async function cardIdsIn(page: Page, columnTestId: string): Promise<string[]> {
  return page
    .getByTestId(columnTestId)
    .locator('[data-testid^="application-card-"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-testid') ?? ''));
}

test('the board shows the review flow, with Needs review sorted by fit', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const summary = `Strong backend match ${stamp}.\nWeak on frontend.`;
  const jobDescription = `We are hiring an intern ${stamp} to build internal tools.`;

  const draft = await createApplicationViaApi(page, { company: `T-Pipe Draft ${stamp}` });
  const proposing = await createApplicationViaApi(page, { company: `T-Pipe Stripe ${stamp}` });
  const best = await createApplicationViaApi(page, {
    company: `T-Pipe Google ${stamp}`,
    roleTitle: 'FDE intern',
  });
  const unscored = await createApplicationViaApi(page, { company: `T-Pipe Notion ${stamp}` });
  const good = await createApplicationViaApi(page, { company: `T-Pipe Ramp ${stamp}` });
  const ready = await createApplicationViaApi(page, { company: `T-Pipe Figma ${stamp}` });

  await setApplicationPipelineState(proposing, { status: 'proposing' });
  await setApplicationPipelineState(best, {
    status: 'needs_review',
    fitScore: 4.3,
    agentSummary: summary,
    jobDescription,
  });
  await setApplicationPipelineState(unscored, { status: 'needs_review' });
  await setApplicationPipelineState(good, { status: 'needs_review', fitScore: 3.9 });
  await setApplicationPipelineState(ready, { status: 'ready', fitScore: 4 });

  await page.goto('/');
  await expect(page.getByTestId(`application-card-${draft}`)).toBeVisible();

  // Six columns, in the order an application moves through them. The count
  // sits in the heading too, and varies with whatever else is in the dev DB.
  const headings = await page
    .locator('section:has([data-testid^="kanban-column-"]) > h2')
    .allTextContents();
  expect(headings.map((heading) => heading.replace(/\d+$/, ''))).toEqual([
    'Draft',
    'Proposing',
    'Needs review',
    'Ready',
    'Interviewing',
    'Offered',
  ]);

  await expect(
    page.getByTestId('kanban-column-proposing').getByTestId(`application-card-${proposing}`),
  ).toBeVisible();
  await expect(
    page.getByTestId('kanban-column-ready').getByTestId(`application-card-${ready}`),
  ).toContainText('fit 4.0');

  // Best fit first, unscored last — filtered to this test's own cards.
  const mine = new Set([best, good, unscored].map((id) => `application-card-${id}`));
  const needsReview = (await cardIdsIn(page, 'kanban-column-needs_review')).filter((id) =>
    mine.has(id),
  );
  expect(needsReview).toEqual([
    `application-card-${best}`,
    `application-card-${good}`,
    `application-card-${unscored}`,
  ]);
  await expect(page.getByTestId(`application-card-${best}`)).toContainText('fit 4.3');
  await expect(page.getByTestId(`application-card-${unscored}`)).not.toContainText('fit');

  // The application page shows what the agent supplied, read-only.
  await page.goto(`/applications/${best}`);
  await expect(page.locator('header').getByText('Needs review', { exact: true })).toBeVisible();
  // The picker cannot set a flow status, but still shows the real one.
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue('needs_review');
  await expect(page.getByRole('heading', { name: /Agent summary/ })).toContainText('fit 4.3');
  await expect(page.getByTestId('application-agent-summary')).toContainText(
    `Strong backend match ${stamp}.`,
  );
  await expect(page.getByTestId('application-job-description')).toContainText(jobDescription);

  // An application logged by hand has nothing from the agent, so no panel.
  await page.goto(`/applications/${draft}`);
  await expect(page.locator('header').getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Job description' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Agent summary/ })).toHaveCount(0);
});

test('flow columns refuse drops, but a Ready card can still be sent', async ({ page }) => {
  await login(page);

  const stamp = Date.now();
  const draft = await createApplicationViaApi(page, { company: `T-Pipe Drop ${stamp}` });
  const ready = await createApplicationViaApi(page, { company: `T-Pipe Sent ${stamp}` });
  await setApplicationPipelineState(ready, { status: 'ready', fitScore: 4 });

  // A drop that the board accepted would PATCH; a refused one sends nothing.
  const draftPatches: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().endsWith(`/api/applications/${draft}`)) {
      draftPatches.push(request.url());
    }
  });

  await page.goto('/');
  const draftCard = `application-card-${draft}`;
  await expect(page.getByTestId('kanban-column-draft').getByTestId(draftCard)).toBeVisible();

  // Dropping on Ready or Proposing puts the card back where it came from.
  await dragCardOnto(page, draftCard, 'kanban-column-ready');
  await expect(page.getByTestId('kanban-column-draft').getByTestId(draftCard)).toBeVisible();
  await dragCardOnto(page, draftCard, 'kanban-column-proposing');
  await expect(page.getByTestId('kanban-column-draft').getByTestId(draftCard)).toBeVisible();
  expect(draftPatches).toEqual([]);

  // Still a draft after a reload: nothing was persisted either.
  await page.reload();
  await expect(page.getByTestId('kanban-column-draft').getByTestId(draftCard)).toBeVisible();
  await expect(page.getByTestId('kanban-column-ready').getByTestId(draftCard)).toHaveCount(0);

  // A Ready card leaves for Applied like any other, and only now counts as sent.
  const readyCard = `application-card-${ready}`;
  await expect(page.getByTestId('kanban-column-ready').getByTestId(readyCard)).toBeVisible();
  await dragCardOnto(page, readyCard, 'kanban-exit-applied');
  await expect(page.getByTestId(readyCard)).toHaveCount(0);

  await page.getByRole('tab', { name: /applied/i }).click();
  const row = page.getByTestId(`applied-row-${ready}`);
  // The Applied column is the third; '—' would mean applied_at was never stamped.
  await expect(row.locator('td').nth(2)).toHaveText(/\d{4}/);

  await page.reload();
  await page.getByRole('tab', { name: /applied/i }).click();
  await expect(page.getByTestId(`applied-row-${ready}`).locator('td').nth(2)).toHaveText(/\d{4}/);
});
