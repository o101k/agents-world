import type { Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';

/** Opens the app on the worlds screen, leaving any world that was open. */
export async function openWorldsScreen(app: App, browser: Browser, screen: Screen) {
  await app.open('/');
  await expect(browser.locator('.world-screen, .worlds-screen')).toBeVisible();
  const back = screen.getByRole('button', '← Worlds');
  if (await back.isVisible()) await back.tap();
}

/** Fills in the new-world form (sample cast) and creates the world; it opens straight away. */
export async function createWorld(screen: Screen, name: string) {
  await screen.getByLabel('Name').first().fill(name);
  await screen.getByRole('button', 'Next: choose brains').tap();
  await expect(screen.getByRole('dialog', 'Choose their brains')).toBeVisible();
  await screen.getByRole('button', 'Create world').tap();
}
