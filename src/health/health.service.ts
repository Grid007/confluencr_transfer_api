import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ServiceUnavailableError } from '../common/errors/app.exception.js';
import { InjectDb, type Db } from '../database/database.constants.js';

const TIMEOUT_MS = 1000;

export interface HealthReport {
  status: 'ok';
  checks: { database: { status: 'up'; latency_ms: number } };
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

  /** Readiness: the database answers a trivial query within one second. */
  async check(version: string): Promise<HealthReport> {
    const started = Date.now();
    try {
      await withTimeout(this.db.execute(sql`select 1`));
    } catch (err) {
      throw new ServiceUnavailableError({
        checks: {
          database: { status: 'down', error: err instanceof Error ? err.message : 'unknown' },
        },
      });
    }
    return {
      status: 'ok',
      checks: { database: { status: 'up', latency_ms: Date.now() - started } },
      version,
      uptime_s: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
