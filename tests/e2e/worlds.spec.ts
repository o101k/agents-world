import { expect, test } from '@playwright/test';

test('create, view, switch and delete worlds', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New world' })).toBeVisible();

  // Create the first world; it opens straight away.
  await page.getByLabel('Name').fill('Alpha Village');
  await page.getByLabel(/Seed/).fill('alpha');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');
  await expect(page.locator('[data-testid="map"] canvas')).toBeVisible();

  // Clicking the map selects something.
  const map = page.locator('[data-testid="map"]');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.selection-title')).toBeVisible();

  // Create a second world and switch between them.
  await page.getByRole('button', { name: '← Worlds' }).click();
  await page.getByLabel('Name').fill('Bravo Town');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Bravo Town');
  await page.getByRole('button', { name: '← Worlds' }).click();
  await expect(page.locator('.world-card')).toHaveCount(2);
  await page
    .locator('.world-card', { hasText: 'Alpha Village' })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');

  // The active world survives a reload.
  await page.reload();
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');

  // Delete one world (with confirmation).
  await page.getByRole('button', { name: '← Worlds' }).click();
  await page
    .locator('.world-card', { hasText: 'Bravo Town' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page.getByRole('button', { name: 'Delete world' }).click();
  await expect(page.locator('.world-card')).toHaveCount(1);
  await expect(page.locator('.world-card')).toContainText('Alpha Village');
});
