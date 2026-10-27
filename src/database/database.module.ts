import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../config/env.schema.js';
import { DRIZZLE, type Db } from './database.constants.js';
import * as schema from './schema/index.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.$client.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db => {
        const url = config.get('DATABASE_URL', { infer: true });
        // postgres.js connects lazily, so building the app (e.g. to export OpenAPI) needs no database.
        const client = postgres(url, {
          max: config.get('DB_POOL_MAX', { infer: true }),
          idle_timeout: 20,
          max_lifetime: 60 * 30,
          connect_timeout: 10,
          onnotice: () => undefined,
          connection: { application_name: 'ledger-api' },
        });
        return drizzle({ client, schema, casing: 'snake_case' });
      },
    },
    DatabaseLifecycle,
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
