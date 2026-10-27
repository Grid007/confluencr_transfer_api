import { z } from 'zod';

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresUrl,
  DIRECT_URL: postgresUrl.optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_PREPARE: z.enum(['auto', 'true', 'false']).default('auto'),
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  BODY_LIMIT: z.string().default('100kb'),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (raw: Record<string, unknown>): Env => envSchema.parse(raw);

/**
 * Prepared statements must be off behind PgBouncer / Supavisor *transaction* pooling
 * (Supabase port 6543). "auto" detects that from the URL.
 */
export function resolvePrepare(mode: Env['DB_PREPARE'], databaseUrl: string): boolean {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  try {
    const url = new URL(databaseUrl);
    if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') return false;
  } catch {
    // An unparsable URL is rejected by the env schema before we get here.
  }
  return true;
}
