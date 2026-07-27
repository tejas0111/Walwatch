import pino from 'pino';
import { resetDb } from '../db/index.js';

const log = pino({ name: 'graceful-shutdown' });

const force_exit_timeout = 30_000;

export function setupGracefulShutdown(server: { close: (cb: (err?: Error) => void) => void }) {
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Received shutdown signal');

    const forceExit = setTimeout(() => {
      log.error('Forced shutdown after timeout');
      process.exit(1);
    }, force_exit_timeout);

    server.close((err) => {
      if (err) {
        log.error({ err }, 'Error closing server');
      } else {
        log.info('Server stopped accepting new requests');
      }

      try {
        resetDb();
        log.info('Database connections closed');
      } catch (e) {
        log.error({ err: e }, 'Error closing database');
      }

      clearTimeout(forceExit);
      log.info('Shutdown complete');
      process.exit(0);
    });

  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
