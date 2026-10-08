import { expect } from 'e2e';
import { test } from '@e2e-dev/web';
import { createWorld, openWorldsScreen } from './helpers.ts';

test('create a world and see its map and villagers', async ({ app, browser, screen }) => {
  await openWorldsScreen(app, browser, screen);
  await createWorld(screen, 'Agentic Village');

  await expect(browser.locator('.topbar-title')).toHaveText('Agentic Village');
  await expect(browser.locator('[data-testid="map"] canvas')).toBeVisible();

  await screen.getByRole('tab', 'People').tap();
  await expect(browser.locator('.person-row')).toHaveCount(11);
});
