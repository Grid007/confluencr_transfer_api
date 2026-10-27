import postgres from 'postgres';
import { loadReconcileQueries } from './reconcile-queries.js';

try {
  process.loadEnvFile();
} catch {
  // .env is optional.
}

/** Prints violations and exits non-zero if any reconciliation query returns rows. */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  let violations = 0;
  try {
    for (const query of loadReconcileQueries()) {
      const rows = await client.unsafe(query.sql);
      console.log(
        `${rows.length === 0 ? 'ok  ' : 'FAIL'} ${query.name} (${rows.length} violations)`,
      );
      if (rows.length > 0) console.table(rows.slice(0, 10));
      violations += rows.length;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
  process.exit(violations === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
