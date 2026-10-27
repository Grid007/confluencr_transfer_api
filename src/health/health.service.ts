import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ServiceUnavailableError } from '../common/errors/app.exception.js';
import { InjectDb, type Db } from '../database/database.constants.js';

const TIMEOUT_MS = 1000;

export interface HealthReport {
  status: 'ok';
  checks: { database: { status: 'up'; latency_ms: number }; ledger_access: { status: 'ok' } };
  version: string;
  uptime_s: number;
  timestamp: string;
}

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
  ]);

@Injectable()
export class HealthService {
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * Readiness: the database answers, and this connection can actually see the ledger tables.
   * Tables have row level security enabled without policies, so a non-owner role would silently see
   * zero rows (every account a 404); detect that here instead of letting it look like data loss.
   */
  async check(version: string): Promise<HealthReport> {
    const started = Date.now();
    try {
      const [row] = await withTimeout(
        this.db.execute<{ ok: boolean | null }>(sql`
          select bool_and(
                   not c.relrowsecurity
                   or pg_has_role(current_user, c.relowner, 'USAGE')
                   or coalesce((select rolbypassrls from pg_roles where rolname = current_user), false)
                 ) as ok
            from pg_class c
           where c.relnamespace = 'public'::regnamespace
             and c.relname in ('accounts', 'transactions', 'transfers')`),
      );
      const latency = Date.now() - started;
      if (row?.ok === null || row?.ok === undefined) {
        throw new ServiceUnavailableError({
          checks: {
            database: { status: 'up', latency_ms: latency },
            ledger_access: { status: 'schema missing: run migrations' },
          },
        });
      }
      if (!row.ok) {
        throw new ServiceUnavailableError({
          checks: {
            database: { status: 'up', latency_ms: latency },
            ledger_access: { status: 'blocked by row level security: connect as the table owner' },
          },
        });
      }
      return {
        status: 'ok',
        checks: {
          database: { status: 'up', latency_ms: latency },
          ledger_access: { status: 'ok' },
        },
        version,
        uptime_s: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof ServiceUnavailableError) throw err;
      throw new ServiceUnavailableError({
        checks: {
          database: { status: 'down', error: err instanceof Error ? err.message : 'unknown' },
        },
      });
    }
  }
}
