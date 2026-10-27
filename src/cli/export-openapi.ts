import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../app.module.js';
import { configureApp, swaggerConfig } from '../app.setup.js';

/** Writes docs/openapi.json from the running code. postgres.js is lazy, so no database is needed. */
async function main(): Promise<void> {
  process.env.DATABASE_URL ??= 'postgres://export:export@localhost:5432/export';
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'production';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  configureApp(app);
  await app.init();
  const document = SwaggerModule.createDocument(app, swaggerConfig());
  const out = resolve(import.meta.dirname, '../../docs/openapi.json');
  await mkdir(resolve(out, '..'), { recursive: true });
  await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`wrote ${out}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
