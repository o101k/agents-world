import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4798;
// Each run gets a fresh, throwaway data folder so tests never touch your real worlds.
const dataDir = process.env.AW_E2E_DATA ?? mkdtempSync(join(tmpdir(), 'aw-e2e-'));
process.env.AW_E2E_DATA = dataDir;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  // In CI: fail on a stray test.only, and keep an HTML report to download when something fails.
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      // Optional: point at an existing Chromium instead of `npx playwright install chromium`.
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: 'bun run --cwd apps/server start',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    env: {
      AGENTS_WORLD_HOME: dataDir,
      AW_NO_OPEN: '1',
      AW_PORT: String(PORT),
      // Never reach a real Claude subscription from tests, even where Claude Code is installed.
      AW_CLAUDE_CLI: 'off',
    },
  },
});
