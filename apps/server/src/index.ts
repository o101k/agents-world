import open from 'open';
import { DEV_WEB_PORT, loadConfig } from './config.ts';
import { buildApp } from './app.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { server, worlds } = await buildApp(config, {
    logger: { level: 'warn' },
    log: (msg) => console.log(`  ${msg}`),
    autoStart: false,
  });

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch (err) {
    await server.close().catch(() => {});
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `\nPort ${config.port} is already in use. Agents World may already be running — ` +
          `open http://127.0.0.1:${config.port} or stop the other process (or set AW_PORT).\n`,
      );
      process.exit(1);
    }
    throw err;
  }

  worlds.start();

  const url = config.dev ? `http://localhost:${DEV_WEB_PORT}` : `http://127.0.0.1:${config.port}`;
  console.log(`\n  Agents World is running at ${url}`);
  console.log(`  Worlds are saved in ${config.dataDir}`);
  console.log('  Press Ctrl+C to stop.\n');
  if (config.openBrowser && !config.dev) {
    open(url).catch(() => console.log(`  (Could not open a browser automatically — visit ${url})`));
  }

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) {
      if (signal === 'SIGINT') {
        console.error('\n  Second SIGINT received — forcing exit.');
        process.exit(130);
      }
      return;
    }
    stopping = true;
    console.log(`\n  ${signal} received — saving and shutting down…`);
    const forceTimer = setTimeout(() => {
      console.error('  Shutdown timed out after 10s — forcing exit.');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();
    try {
      await server.close();
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      console.error('  Error during shutdown:', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
