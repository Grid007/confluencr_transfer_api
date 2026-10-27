import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile();
} catch {
  // .env is optional (CI and containers provide the real environment).
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/*.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  breakpoints: true,
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '' },
  migrations: { table: '__drizzle_migrations', schema: 'drizzle' },
});
