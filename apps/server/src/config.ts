import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_VERSION = '0.1.0';
export const DEFAULT_PORT = 4747;
export const DEV_WEB_PORT = 5173;

export interface ServerConfig {
  /** Where worlds, settings and (later) API keys are stored. Never inside the repo. */
  dataDir: string;
  port: number;
  /** Always loopback: the helper must never be reachable from other machines. */
  host: '127.0.0.1';
  /** Dev mode: the UI is served by Vite on DEV_WEB_PORT and proxied here. */
  dev: boolean;
  openBrowser: boolean;
  /** Built UI to serve, if present. */
  webDistDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = resolve(here, '../../web/dist');
  const port = env.AW_PORT ? Number(env.AW_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid AW_PORT: ${env.AW_PORT}`);
  }
  return {
    dataDir: resolve(env.AGENTS_WORLD_HOME ?? join(homedir(), '.agents-world')),
    port,
    host: '127.0.0.1',
    dev: env.AW_DEV === '1',
    openBrowser: env.AW_NO_OPEN !== '1',
    webDistDir: existsSync(join(dist, 'index.html')) ? dist : null,
  };
}
