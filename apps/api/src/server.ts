#!/usr/bin/env node
/**
 * Process entry point: configuration, listener, scheduler and graceful
 * shutdown.
 *
 * 10_DEPLOYMENT.md: "Provide graceful shutdown and task lease recovery."
 *
 * A note on lease recovery, because the wording invites a wrong
 * implementation: the API does not *hold* leases — workers do. There is
 * therefore nothing for this process to hand back on SIGTERM. Recovery works
 * the other way round: a lease has a 120-second expiry, and both the claim
 * path and the scheduler return expired leases to the queue. Shutting the API
 * down cleanly means refusing new connections, draining in-flight requests,
 * stopping the scheduler mid-sweep-safe, and closing the pool.
 *
 * Migrations are deliberately *not* run here. They run as a one-shot Compose
 * service before the API becomes ready, and `/health/ready` fails until they
 * have.
 */
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { closeDb } from './db/pool.js';
import { loggerFromConfig } from './logging.js';
import { createStorageDriver } from './files/storage.js';
import { createScheduler } from './tasks/scheduler.js';

const SHUTDOWN_GRACE_MS = 15_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Plain stderr, not the structured logger: the logger's own level comes
      // from the configuration that just failed to load.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = loggerFromConfig(config);
  const storage = createStorageDriver(config);
  const { app, context, ownsPool } = await buildApp(config, { logger, storage });

  const scheduler = createScheduler({ db: context.db, storage, logger });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    // Hard deadline so a stuck request cannot hold the container open forever
    // and get SIGKILLed mid-transaction instead.
    const deadline = setTimeout(() => {
      logger.error({ signal }, 'graceful shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    deadline.unref();

    try {
      // 1. Stop accepting and drain what is already in flight.
      await app.close();
      // 2. Let any running housekeeping job finish rather than aborting it.
      await scheduler.stop();
      // 3. Release database connections.
      if (ownsPool) await closeDb(context.db, context.pool);
      logger.info({ signal }, 'shutdown complete');
      clearTimeout(deadline);
      process.exit(0);
    } catch (error) {
      logger.error({ signal, err: error }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    logger.error({ err: error }, 'failed to bind listener');
    process.exit(1);
  }

  scheduler.start();

  logger.info(
    {
      mode: config.appMode,
      port: config.port,
      storage: config.storageDriver,
      origin: config.appOrigin,
    },
    'api listening',
  );
}

void main();
