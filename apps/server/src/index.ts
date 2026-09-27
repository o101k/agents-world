import open from 'open';
import { DEV_WEB_PORT, loadConfig } from './config.ts';
import { buildApp } from './app.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { server } = await buildApp(config, {
    logger: { level: 'warn' },
    log: (msg) => console.log(`  ${msg}`),
  });

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `\nPort ${config.port} is already in use. Agents World may already be running — ` +
          `open http://127.0.0.1:${config.port} or stop the other process (or set AW_PORT).\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  const url = config.dev ? `http://localhost:${DEV_WEB_PORT}` : `http://127.0.0.1:${config.port}`;
  console.log(`\n  Agents World is running at ${url}`);
  console.log(`  Worlds are saved in ${config.dataDir}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (config.openBrowser && !config.dev) {
    open(url).catch(() => console.log(`  (Could not open a browser automatically — visit ${url})`));
  }

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n  ${signal} received — saving and shutting down…`);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
