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
  await expect(page.locator('.person-row')).toHaveCount(11);

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

test('observer powers: spawn a person and set up AI settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();

  // Settings open and show the providers; keys are never displayed.
  await page.getByRole('button', { name: '⚙ AI settings' }).click();
  await expect(page.locator('.provider-card', { hasText: 'Anthropic' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel('Name').fill('Spawn Village');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Spawn Village');

  await page.getByRole('button', { name: '+ Spawn' }).click();
  await page
    .getByLabel('Description')
    .fill('A weary pedlar with a cart of pots and a head full of tall tales.');
  await page.getByLabel(/^Name/).fill('Hob');
  await page.getByRole('button', { name: 'Spawn', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('Hob');
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.locator('.person-row')).toHaveCount(12);
  await expect(page.locator('.spend-meter')).toContainText('$0');
});

test('write your own cast and see the family tree', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();

  await page.getByLabel('Name').first().fill('Family Village');
  await page.getByLabel('Write your own').check();
  await expect(page.locator('.cast-card')).toHaveCount(5); // starter cast to edit
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Family Village');
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.locator('.person-row')).toHaveCount(5);
  await page.locator('.person-row', { hasText: 'Anna Berg' }).click();
  await expect(page.locator('.inspector')).toContainText('Erik Berg');
  await page.getByRole('button', { name: 'Family tree' }).click();
  await expect(page.locator('.family-tree')).toContainText('Lotta Berg');
  await expect(page.locator('.tree-person.is-root')).toContainText('Anna Berg');
});

test('world events, timeline search and a life story', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();
  await page.getByLabel('Name').first().fill('Stormy Village');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Stormy Village');

  // Start a storm: it shows in the conditions bar and the timeline.
  await page.getByRole('button', { name: '⚡ Events' }).click();
  await page.getByRole('radio', { name: /Storm/ }).click();
  await page.getByRole('button', { name: 'Start storm' }).click();
  await expect(page.locator('.conditions-bar')).toContainText('Storm');
  await expect(page.locator('.event-log')).toContainText('storm is sweeping');

  // Set a house on fire.
  await page.getByRole('button', { name: '⚡ Events' }).click();
  await page.getByRole('radio', { name: /Fire/ }).click();
  await page.getByLabel('Building').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Start fire' }).click();
  await expect(page.locator('.conditions-bar')).toContainText('is burning');

  // Search the history.
  await page.getByLabel('Search the timeline').fill('fire');
  await expect(page.locator('.event-list .event').first()).toContainText('on fire');
  await page.getByLabel('Search the timeline').fill('zzqqxx');
  await expect(page.locator('.event-list')).toContainText('Nothing in the history matches');
  await page.getByLabel('Search the timeline').fill('');

  // A person's memory and life story.
  await page.getByRole('tab', { name: 'People' }).click();
  await page.locator('.person-row', { hasText: 'Maren Holt' }).click();
  await expect(page.locator('.inspector')).toContainText('Memory');
  await page.getByRole('tab', { name: /Forgotten/ }).click();
  await page.getByRole('button', { name: 'Life story' }).click();
  await expect(page.locator('.modal.story')).toContainText('The life of Maren Holt');
});

test('replay: scrub the map back in time and return to live', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();
  await page.getByLabel('Name').first().fill('Replay Village');
  await page.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Replay Village');

  // Let some time pass.
  await page.getByRole('button', { name: 'Max' }).click();
  await page.getByTestId('play-pause').click();
  await expect(page.locator('.topbar-clock')).toContainText('Day 2', { timeout: 20_000 });
  await page.getByTestId('play-pause').click();

  // Replay starts an hour ago; go back to the very beginning, then step forward an hour.
  await page.getByRole('button', { name: '⏪ Replay' }).click();
  await expect(page.getByTestId('replay-clock')).toContainText('Day');
  await page.getByLabel('Moment in history').press('Home');
  await expect(page.getByTestId('replay-clock')).toHaveText('Day 1, 07:00 · spring');
  await page.getByRole('button', { name: '+1h' }).click();
  await expect(page.getByTestId('replay-clock')).toHaveText('Day 1, 08:00 · spring');
  await expect(page.locator('.event-log h2')).toContainText('Timeline to Day 1, 08:00');
  // People can be inspected as they were.
  await page.getByRole('tab', { name: 'People' }).click();
  await page.locator('.person-row', { hasText: 'Maren Holt' }).click();
  await expect(page.locator('.inspector')).toContainText('(replay)');

  await page.getByRole('button', { name: 'Back to live' }).click();
  await expect(page.locator('.replay-bar')).toHaveCount(0);
  await expect(page.locator('.event-log h2')).toHaveText('Timeline');
});
