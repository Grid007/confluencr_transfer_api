import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

async function applyMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client }), {
      migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * One real PostgreSQL per test run. Set TEST_DATABASE_URL to reuse an existing database instead
 * (Docker unavailable): it is migrated and left in place, tests only ever create fresh accounts.
 */
export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    await applyMigrations(external);
    project.provide('databaseUrl', external);
    return;
  }

  const container = await new PostgreSqlContainer('postgres:17.11-alpine')
    .withTmpFs({ '/var/lib/postgresql/data': 'rw,noexec,nosuid,size=256m' })
    .withStartupTimeout(120_000)
    .start();
  const url = container.getConnectionUri();
  await applyMigrations(url);
  project.provide('databaseUrl', url);
  return async () => {
    await container.stop();
  };
}
