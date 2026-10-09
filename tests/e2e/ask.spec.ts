import { expect, test, type Page } from '@playwright/test';

// Same world-creation steps as worlds.spec.ts (kept local so this file stands alone).
async function createWorld(page: Page, name: string) {
  await page.getByLabel('Name').first().fill(name);
  await page.getByRole('button', { name: 'Next: choose brains' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose their brains' })).toBeVisible();
  await page.getByRole('button', { name: 'Create world' }).click();
}

test('ask about a villager and read the record', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen, .topbar-title')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();
  await createWorld(page, 'Ask Village');
  await expect(page.locator('.topbar-clock')).toContainText('Day 1, 07:00');

  // Let a little time pass so there is something to read.
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByRole('button', { name: '200×' }).click();
  await page.getByTestId('play-pause').click();
  await expect(page.locator('.event-list .event').first()).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('play-pause').click();
  await expect(page.getByTestId('play-pause')).toHaveText(/Play/);

  // Open the first person's inspector and ask a question.
  await page.getByRole('tab', { name: 'People' }).click();
  await page.locator('.person-row').first().click();
  const section = page.locator('.ask-section');
  await expect(section.getByRole('heading', { name: /Ask about/ })).toBeVisible();
  await expect(section.getByText(/Free summary from the record \(Mock brain\)/)).toBeVisible();

  await section.getByRole('textbox', { name: 'Question' }).fill('What did you do today?');
  await section.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.ask-card', { hasText: 'Free summary' }).first()).toBeVisible({
    timeout: 15_000,
  });

  // The full view: every answer, and the record behind it.
  await section.getByRole('button', { name: /All answers and the full record/ }).click();
  const dialog = page.getByRole('dialog', { name: /Ask about/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.ask-line').first()).toBeVisible({ timeout: 10_000 });

  await dialog.getByRole('tab', { name: /Thoughts/ }).click();
  await expect(dialog.locator('.ask-line').first()).toBeVisible({ timeout: 10_000 });

  // Close with the ✕; the inspector is still there.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(section).toBeVisible();
});
