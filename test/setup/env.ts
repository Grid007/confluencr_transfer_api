import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
// Enough connections that 25 parallel debits genuinely contend on the row lock instead of queueing in the pool.
process.env.DB_POOL_MAX = '40';
