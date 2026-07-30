import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { config } from '../config.js';
import pino from 'pino';

const log = pino({ name: 'db' });

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!db) {
    client = postgres(config.databaseUrl, {
      max: config.dbPoolMax,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb() {
  if (client) {
    await client.end();
    client = null;
    db = null;
  }
}

/**
 * Reset the database singleton. Used during graceful shutdown
 * and in tests to swap the connection.
 */
export function resetDb() {
  if (client) {
    client.end().catch((err) => {
      log.error({ err }, 'Failed to close DB connection during reset');
    });
    client = null;
  }
  db = null;
}

export function setDb(customDb: ReturnType<typeof drizzle>) {
  db = customDb;
}
