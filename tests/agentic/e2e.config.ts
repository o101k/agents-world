import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { model } from './model.ts';

// Every worker imports this file again, so the throwaway data folder is kept in the environment
// (inherited by the workers) and the helper never touches the owner's real worlds.
const dataDir = (process.env.AW_AGENTIC_DATA ??= mkdtempSync(join(tmpdir(), 'aw-agentic-')));

const context = [
  'This is Agents World, a village life simulation in the browser.',
  'The worlds screen lists saved worlds with an Open and a Delete button, and a "New world" form.',
  'In the form, fill in the "Name" field, click "Next: choose brains", then click "Create world".',
  'Inside a world, the top bar shows the world title and the clock; the left side is the map.',
  'The People tab lists villagers. Clicking a person opens an inspector with their needs.',
  'The "← Worlds" button returns to the worlds screen.',
].join(' ');

export default {
  tests: ['*.e2e.ts'],
  workers: 1,
  targets: [
    {
      name: 'web',
      engine: web(),
      app: {
        url: 'http://127.0.0.1:0',
        // e2e starts the helper on a free port. It hands it only PATH, HOME and this env, so the
        // helper never sees your API keys and the test villagers think with the free Mock brain.
        command: {
          executable: 'npm',
          args: ['run', 'start', '-w', '@aw/server'],
          cwd: '../..',
          env: {
            AGENTS_WORLD_HOME: dataDir,
            AW_NO_OPEN: '1',
            AW_PORT: '{port}',
            AW_CLAUDE_CLI: 'off',
            AW_AGY_CLI: 'off',
          },
          log: '.e2e/logs/helper.log',
        },
        readyUrl: 'http://127.0.0.1:{port}/api/health',
      },
    },
  ],
  agents: model ? { default: { model, context } } : {},
} satisfies E2EConfig;
