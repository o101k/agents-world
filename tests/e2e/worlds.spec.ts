import { expect, test, type Page } from '@playwright/test';

/** Finish the new-world form: step 1 previews the villagers, step 2 (brains) accepts the defaults. */
async function chooseBrainsAndCreate(page: Page) {
  await page.getByRole('button', { name: 'Next: choose brains' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose their brains' })).toBeVisible();
  await page.getByRole('button', { name: 'Create world' }).click();
}

/** Fill in the new-world form (sample cast) and create the world. */
async function createWorld(page: Page, name: string, seed?: string) {
  await page.getByLabel('Name').first().fill(name);
  if (seed) await page.getByLabel(/Seed/).fill(seed);
  await chooseBrainsAndCreate(page);
}

test('create, view, switch and delete worlds', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'New world' })).toBeVisible();

  // Create the first world; it opens straight away.
  await createWorld(page, 'Alpha Village', 'alpha');
  await expect(page.locator('.topbar-title')).toHaveText('Alpha Village');
  await expect(page.locator('[data-testid="map"] canvas')).toBeVisible();

  // Clicking the map selects something.
  const map = page.locator('[data-testid="map"]');
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.selection-title, .inspector')).toBeVisible();

  // Create a second world and switch between them.
  await page.getByRole('button', { name: '← Worlds' }).click();
  await createWorld(page, 'Bravo Town');
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
  await createWorld(page, 'Live Village', 'live');
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
  await expect(page.locator('.provider-card', { hasText: 'Anthropic (Claude)' })).toBeVisible();
  await expect(page.locator('.provider-card', { hasText: 'Claude subscription' })).toContainText(
    'Not set up',
  );
  await page.getByRole('button', { name: 'Close' }).click();

  await createWorld(page, 'Spawn Village');
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
  await chooseBrainsAndCreate(page);
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
  await createWorld(page, 'Stormy Village');
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

  // The burning house's history: open it from its timeline entry.
  await page
    .locator('.event-list .event', { hasText: 'on fire' })
    .first()
    .locator('.event-text')
    .click();
  const selected = page.locator('.selection');
  await expect(selected).toContainText('Part of the village since it was founded.');
  await expect(selected.locator('.object-history').first()).toContainText('is on fire!');
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
  await createWorld(page, 'Replay Village');
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

test("choose each villager's brain when creating a world, then change them in the world", async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();

  // Step 1 is the usual form; step 2 lists everyone who will live there.
  await page.getByLabel('Name').first().fill('Brainy Village');
  await page.getByLabel(/Seed/).fill('brains');
  await page.getByRole('button', { name: 'Next: choose brains' }).click();
  const setup = page.getByRole('dialog', { name: 'Choose their brains' });
  await expect(setup.locator('tbody tr')).toHaveCount(11);
  await expect(setup.locator('tbody tr', { hasText: 'Maren Holt' })).toContainText('Mock');
  // Nothing is set up in the test environment, and the dialog says so instead of staying quiet.
  await expect(setup).toContainText('No AI is set up yet');
  // Choosing brains happens before anything has run, so there is nothing to spend yet.
  await expect(setup.getByRole('columnheader', { name: 'Calls' })).toHaveCount(0);

  // Select everyone at once, give them a provider and effort, apply.
  const bulk = setup.getByRole('region', { name: 'Change brains' });
  await expect(bulk.getByRole('button', { name: /^Apply to/ })).toBeDisabled();
  await setup.getByRole('checkbox', { name: 'Select all' }).check();
  await expect(setup).toContainText('11 of 11 selected');
  await bulk.getByLabel('Provider').selectOption('anthropic');
  await bulk.getByLabel('Effort').selectOption('deep');
  await bulk.getByRole('button', { name: 'Apply to 11 selected' }).click();
  await expect(setup).toContainText('Updated 11 people.');
  for (const row of await setup.locator('tbody tr').all()) {
    await expect(row).toContainText('Anthropic (Claude)');
    await expect(row).toContainText('Deep');
  }

  // Quick selectors, and one person changed on their own with their Change button.
  await setup.getByRole('button', { name: 'Children', exact: true }).click();
  await expect(setup).toContainText('3 of 11 selected');
  await setup.getByRole('button', { name: 'Adults', exact: true }).click();
  await expect(setup).toContainText('8 of 11 selected');
  await setup.getByRole('button', { name: 'None', exact: true }).click();
  await setup.getByRole('button', { name: 'Change the brain of Maren Holt' }).click();
  await expect(setup).toContainText('1 of 11 selected');
  await expect(bulk.getByLabel('Effort')).toHaveValue('deep');
  await bulk.getByLabel('Provider').selectOption('mock');
  await bulk.getByRole('button', { name: 'Apply to 1 selected' }).click();
  await expect(setup.locator('tbody tr', { hasText: 'Maren Holt' })).toContainText('Mock');
  await expect(setup.locator('tbody tr', { hasText: 'Tobias Holt' })).toContainText(
    'Anthropic (Claude)',
  );

  // Back keeps the form and the choices; Escape does the same.
  await setup.getByRole('button', { name: 'Back' }).click();
  await expect(setup).toBeHidden();
  await expect(page.getByLabel('Name').first()).toHaveValue('Brainy Village');
  await page.getByRole('button', { name: 'Next: choose brains' }).click();
  await expect(setup.locator('tbody tr', { hasText: 'Maren Holt' })).toContainText('Mock');
  await expect(setup.locator('tbody tr', { hasText: 'Tobias Holt' })).toContainText(
    'Anthropic (Claude)',
  );
  await page.keyboard.press('Escape');
  await expect(setup).toBeHidden();
  await page.getByRole('button', { name: 'Next: choose brains' }).click();

  // Newborns and spawned people get their own default.
  await setup.getByRole('button', { name: 'Change default' }).click();
  await setup
    .getByRole('region', { name: 'Default brain' })
    .getByLabel('Provider')
    .selectOption('openai');
  await setup.getByRole('button', { name: 'Save default' }).click();
  await expect(setup.getByRole('region', { name: 'Default brain' })).toContainText('OpenAI');

  await setup.getByRole('button', { name: 'Create world' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Brainy Village');

  // In the world, the same dialog also shows what each person has used.
  await page.getByRole('button', { name: '🧠 Brains' }).click();
  const brains = page.getByRole('dialog', { name: 'Brains and spending' });
  await expect(brains.locator('tbody tr')).toHaveCount(11);
  for (const heading of ['Calls', 'Tokens in', 'Tokens out', 'Cost'])
    await expect(brains.getByRole('columnheader', { name: heading })).toBeVisible();
  const maren = brains.locator('tbody tr', { hasText: 'Maren Holt' });
  await expect(maren).toContainText('Mock');
  await expect(maren).toContainText('$0');
  await expect(brains.locator('tbody tr', { hasText: 'Tobias Holt' })).toContainText('Deep');
  await expect(brains.getByTestId('brains-totals')).toContainText('Whole village');
  await expect(brains.getByTestId('brains-totals')).toContainText('$0');
  await expect(brains.getByRole('region', { name: 'Default brain' })).toContainText('OpenAI');

  // Pick two people and change their effort in one go.
  const bulkNow = brains.getByRole('region', { name: 'Change brains' });
  await brains.getByRole('checkbox', { name: 'Select Tobias Holt' }).check();
  await brains.getByRole('checkbox', { name: 'Select Elsbeth Crane' }).check();
  await expect(brains).toContainText('2 of 11 selected');
  await bulkNow.getByLabel('Provider').selectOption('anthropic');
  await bulkNow.getByLabel('Effort').selectOption('frugal');
  await bulkNow.getByRole('button', { name: 'Apply to 2 selected' }).click();
  await expect(brains).toContainText('Updated 2 people.');
  for (const who of ['Tobias Holt', 'Elsbeth Crane'])
    await expect(brains.locator('tbody tr', { hasText: who })).toContainText('Frugal');
  await expect(brains.locator('tbody tr', { hasText: 'Piet Morrow' })).toContainText('Deep');

  // Or one person with their own Change button.
  await brains.getByRole('button', { name: 'Change the brain of Piet Morrow' }).click();
  await expect(brains).toContainText('1 of 11 selected');
  await bulkNow.getByLabel('Effort').selectOption('standard');
  await bulkNow.getByRole('button', { name: 'Apply to 1 selected' }).click();
  await expect(brains.locator('tbody tr', { hasText: 'Piet Morrow' })).toContainText('Standard');

  // It was saved in the world, not just on screen; the Done button and Escape both close.
  await brains.getByRole('button', { name: 'Done' }).click();
  await expect(brains).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: '🧠 Brains' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Brains and spending' })
      .locator('tbody tr', { hasText: 'Piet Morrow' }),
  ).toContainText('Standard');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Brains and spending' })).toBeHidden();

  // The World tab links to the same dialog.
  await page.getByRole('tab', { name: 'World' }).click();
  await page.getByRole('button', { name: /Brains & spending/ }).click();
  await expect(page.getByRole('dialog', { name: 'Brains and spending' })).toBeVisible();
});

test('the World tab shows the village: no rules yet, and empty sections', async ({ page }) => {
  await page.goto('/');
  const back = page.getByRole('button', { name: '← Worlds' });
  if (await back.isVisible()) await back.click();
  await createWorld(page, 'Village Panel Town', 'village');
  await expect(page.locator('.topbar-title')).toHaveText('Village Panel Town');

  await page.getByRole('tab', { name: 'World' }).click();
  await expect(page.getByRole('heading', { name: 'Village', exact: true })).toBeVisible();
  await expect(page.getByText('No rules yet.')).toBeVisible();
  await expect(page.getByText('No stalls yet.')).toBeVisible();
});
