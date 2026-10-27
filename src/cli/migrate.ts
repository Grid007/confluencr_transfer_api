import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

try {
  process.loadEnvFile();
} catch {
  // .env is optional: containers and CI provide the real environment.
}

const ADVISORY_LOCK_KEY = 727_001;
const CONNECT_ATTEMPTS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the database to accept connections (it may still be starting or restarting). */
async function connect(url: string): Promise<postgres.Sql> {
  for (let attempt = 1; ; attempt++) {
    const client = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 10 });
    try {
      await client`select 1`;
      return client;
    } catch (err) {
      await client.end({ timeout: 1 }).catch(() => undefined);
      if (attempt >= CONNECT_ATTEMPTS) throw err;
      console.log(`database not ready (attempt ${attempt}/${CONNECT_ATTEMPTS}), retrying...`);
      await sleep(1000);
    }
  }
}

/**
 * Applies pending SQL migrations. Run explicitly (never on API boot) so that several API
 * instances cannot race; an advisory lock also serialises concurrent migrators.
 * Uses DIRECT_URL when set (Supabase: session pooler or direct host).
 */
async function main(): Promise<void> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL (or DIRECT_URL) is required');
    process.exit(1);
  }
  const client = await connect(url);
  try {
    await client`select pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
    await migrate(drizzle({ client }), {
      migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    await client`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
    console.log('migrations applied');
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('migration failed', err);
  process.exit(1);
});
