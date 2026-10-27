import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  configureApp(app);
  const port = app.get<ConfigService<Env, true>>(ConfigService).get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`listening on :${port} (docs at /docs)`);
}

bootstrap().catch((err: unknown) => {
  // Config validation failures land here: print them plainly and exit non-zero.
  console.error('failed to start', err instanceof Error ? err.message : err);
  process.exit(1);
});
