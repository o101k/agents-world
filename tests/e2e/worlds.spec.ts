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
  await expect(page.locator('.selection-title, .inspector')).toBeVisible();

  // Create a second world and switch between them.
  await page.getByRole('button', { name: '← Worlds' }).click();
  await page.getByLabel('Name').fill('Bravo Town');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Bravo Town');
  await page.getByRole('button', { name: '← Worlds' }).click();
  await expect(page.locator('.world-card')).toHaveCount(2);
  await page.locator('.world-card', { hasText: 'Alpha Village' }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');

  // The active world survives a reload.
  await page.reload();
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');

  // Delete one world (with confirmation).
  await page.getByRole('button', { name: '← Worlds' }).click();
  await page.locator('.world-card', { hasText: 'Bravo Town' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete world' }).click();
  await expect(page.locator('.world-card')).toHaveCount(1);
  await expect(page.locator('.world-card')).toContainText('Alpha Village');
});

test('time runs, villagers live, and the world resumes where it was', async ({ page }) => {
  await page.goto('/');
  // The previous test left a world open; go back to the worlds screen.
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();
  await page.getByLabel('Name').fill('Live Village');
  await page.getByLabel(/Seed/).fill('live');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-clock')).toContainText('Day 1, 07:00');

  // Everyone in the sample cast is listed.
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.locator('.person-row')).toHaveCount(8);

  // Run fast for a moment.
  await page.getByRole('button', { name: '200×' }).click();
  await page.getByTestId('play-pause').click();
  await expect(page.locator('.event-list .event').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.topbar-clock')).not.toContainText('Day 1, 07:0', { timeout: 10_000 });
  await page.getByTestId('play-pause').click(); // pause
  await expect(page.getByTestId('play-pause')).toHaveText(/Play/);

  // Inspect a person.
  await page.locator('.person-row', { hasText: 'Maren Holt' }).click();
  await expect(page.locator('.inspector')).toContainText('Maren Holt');
  await expect(page.locator('.inspector')).toContainText('Food');

  // Reload: same tick.
  const clock = await page.locator('.topbar-clock').innerText();
  await page.reload();
  await expect(page.locator('.topbar-clock')).toHaveText(clock);
});
