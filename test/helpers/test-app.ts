import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { type Env, validateEnv } from '../../src/config/env.schema.js';
import { DRIZZLE, type Db } from '../../src/database/database.constants.js';

export interface TestApp {
  app: INestApplication;
  db: Db;
  http: ReturnType<typeof request>;
  close: () => Promise<void>;
}

// @nestjs/config keeps validated values under this key of its internal store (not exported).
const VALIDATED_ENV_KEY = '_PROCESS_ENV_VALIDATED';

/**
 * Boots the real application (same HTTP stack as main.ts) against the test database.
 * `env` overrides individual settings for this app only. ConfigModule.forRoot reads the process
 * environment once at import time, so overrides are applied by replacing the ConfigService.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const config = new ConfigService<Env, true>({
    [VALIDATED_ENV_KEY]: validateEnv({ ...process.env, ...env }),
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  // Listen once on an ephemeral port: supertest would otherwise re-bind the server per request.
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    db: app.get<Db>(DRIZZLE),
    http: request(`http://127.0.0.1:${port}`),
    close: () => app.close(),
  };
}
