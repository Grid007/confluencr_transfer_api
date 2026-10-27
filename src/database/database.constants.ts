import { Inject } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import type * as schema from './schema/index.js';

export const DRIZZLE = Symbol('DRIZZLE');

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const InjectDb = () => Inject(DRIZZLE);
