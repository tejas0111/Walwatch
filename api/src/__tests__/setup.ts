import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../db/schema.js';
import { setDb } from '../db/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

let container: StartedTestContainer;
let client: postgres.Sql;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setupTestDb() {
  container = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({ POSTGRES_PASSWORD: 'test', POSTGRES_DB: 'test' })
    .withExposedPorts(5432)
    .start();

  const connectionString = `postgres://postgres:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;
  client = postgres(connectionString);
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../db/migrations') });

  setDb(db);
  return { db, connectionString, container };
}

export async function teardownTestDb() {
  if (client) await client.end();
  if (container) await container.stop();
}
