import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { z } from 'zod';
import { noModel } from './model.ts';
import { createWorld, openWorldsScreen } from './helpers.ts';

// Each step is a plain-English goal or question for the AI, checked by a locator where the exact
// text matters. These need ANTHROPIC_API_KEY or OPENROUTER_API_KEY and are skipped without one.
describe('AI-driven villagers', { tags: ['ai'], skip: noModel }, () => {
  test('an agent creates a world and the map shows a village', async ({
    app,
    agent,
    browser,
    screen,
  }) => {
    await openWorldsScreen(app, browser, screen);
    await agent.act('create a new world named {name} with the default sample cast', {
      params: { name: 'Agent Village' },
    });

    await expect(browser.locator('.topbar-title')).toHaveText('Agent Village');
    await agent.assert('the map shows a small village with houses, paths and fields', {
      vision: true,
    });
  });

  test('an agent opens a villager and reads their needs', async ({
    app,
    agent,
    browser,
    screen,
  }) => {
    await openWorldsScreen(app, browser, screen);
    await createWorld(screen, 'Needs Village');
    await expect(browser.locator('.topbar-title')).toHaveText('Needs Village');

    await agent.act('open the People tab and select the villager named Maren Holt');
    await expect(browser.locator('.inspector')).toContainText('Maren Holt');
    await agent.assert('the inspector shows the needs of Maren Holt, such as food and water');

    // Selecting someone switches the sidebar to the Selected tab, so go back to the list.
    await screen.getByRole('tab', 'People').tap();
    await expect(browser.locator('.person-row').first()).toBeVisible();

    const names = await agent.extract('the names of every villager in the People list', {
      schema: z.object({ names: z.array(z.string()) }),
    });
    expect(names.names).toContain('Maren Holt');
  });
});
