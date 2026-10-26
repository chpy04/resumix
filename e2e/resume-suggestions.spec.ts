import { expect, test } from '@playwright/test';
import {
  archiveExperienceViaApi,
  createExperienceViaApi,
  createResumeViaApi,
  deleteResumeViaApi,
  getResumeDetail,
  insertResumeSuggestions,
  login,
  renderResumeText,
  setSelectionsViaApi,
} from './support';

/**
 * The agent's suggestions on one of Chris's own resumes, outside any
 * application (D-054): the same cards the review page shows, in that
 * resume's own editor, already in its preview. He rewords one, applies it,
 * and rejects the other, with no review status in the way.
 *
 * The suggestions are written straight to the database, as only the agent
 * makes them, over MCP. They sit on an experience and a resume this test
 * creates, never Default: other specs read the seeded resume, and Apply
 * edits the library. Both are archived or deleted however the test ends.
 */

function flat(text: string): string {
  return text.replace(/\s+/g, '');
}

test("a resume's own suggestions: cards and preview in its editor, then reword, Apply and Reject", async ({
  page,
}) => {
  await login(page);

  const created: { resumeId?: string; experienceId?: string } = {};
  try {
    const stamp = Date.now();
    const resumeId = await createResumeViaApi(page, `T-Own ${stamp}`);
    created.resumeId = resumeId;
    const {
      experienceId,
      bulletIds: [firstId, secondId],
    } = await createExperienceViaApi(page, `T-Own Acme ${stamp}`, [
      `Cut latency ${stamp}`,
      `Shipped tooling ${stamp}`,
    ]);
    created.experienceId = experienceId;
    if (!firstId || !secondId) throw new Error('the bullets were not both created');
    await setSelectionsViaApi(page, resumeId, {
      experiences: [experienceId],
      experienceBullets: { [experienceId]: [firstId, secondId] },
      projects: [],
      projectBullets: {},
      skillRows: [],
      skills: {},
    });

    const editText = `Cut p99 latency 40% ${stamp}`;
    const addText = `Mentored two engineers ${stamp}`;
    const [editId, addId] = await insertResumeSuggestions(resumeId, [
      {
        kind: 'edit',
        bulletId: firstId,
        proposedText: editText,
        rationale: 'Chris asked for numbers',
      },
      {
        kind: 'add',
        parentId: experienceId,
        position: 2,
        proposedText: addText,
        rationale: 'Chris asked for leadership',
      },
    ]);
    if (!editId || !addId) throw new Error('the suggestions were not both added');

    // The editor's preview has them; a plain render, and so a saved PDF,
    // does not.
    const overlaid = flat(await renderResumeText(page, resumeId, 'resume'));
    expect(overlaid).toContain(flat(editText));
    expect(overlaid).toContain(flat(addText));
    const plain = flat(await renderResumeText(page, resumeId));
    expect(plain).not.toContain(flat(editText));
    expect(plain).toContain(flat(`Cut latency ${stamp}`));

    await page.goto(`/resume/${resumeId}`);
    const editCard = page
      .getByTestId(`bullet-row-${firstId}`)
      .getByTestId(`suggestion-card-${editId}`);
    await expect(editCard).toContainText('Suggested edit');
    await expect(editCard).toContainText(`was Cut latency ${stamp}`);
    const addCard = page.getByTestId(`suggestion-card-${addId}`);
    await expect(addCard).toContainText('+ Suggested new bullet');

    // Reword it, as Chris improves what the agent wrote, then Apply.
    const reworded = `Cut p99 latency 40% across 3 services ${stamp}`;
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/bullet-suggestions/${editId}`),
    );
    await editCard.getByRole('textbox', { name: 'Suggested text' }).fill(reworded);
    expect((await saved).ok()).toBe(true);

    let resolved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/bullet-suggestions/${editId}/resolve`),
    );
    await editCard.getByRole('button', { name: 'Apply to bullet' }).click();
    expect((await resolved).ok()).toBe(true);
    await expect(page.getByTestId(`suggestion-card-${editId}`)).toHaveCount(0);
    await expect(page.getByTestId(`bullet-row-${firstId}`).locator('textarea')).toHaveValue(
      `Cut p99 latency 40\\% across 3 services ${stamp}`,
    );

    resolved = page.waitForResponse((response) =>
      response.url().endsWith(`/api/bullet-suggestions/${addId}/resolve`),
    );
    await addCard.getByRole('button', { name: 'Reject' }).click();
    expect((await resolved).ok()).toBe(true);
    await expect(page.getByTestId(`suggestion-card-${addId}`)).toHaveCount(0);

    const detail = await getResumeDetail(page, resumeId);
    expect(detail.suggestions).toEqual([]);
    expect(detail.selections.experienceBullets[experienceId]).toEqual([firstId, secondId]);
    const bullets = detail.library.experiences.find((e) => e.id === experienceId)?.bullets ?? [];
    expect(bullets.find((b) => b.id === firstId)?.content).toBe(
      `Cut p99 latency 40\\% across 3 services ${stamp}`,
    );
    expect(bullets.some((b) => b.content.includes('Mentored'))).toBe(false);
  } finally {
    if (created.resumeId) await deleteResumeViaApi(page, created.resumeId);
    if (created.experienceId) await archiveExperienceViaApi(page, created.experienceId);
  }
});
