import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { APP_NAME, APP_VERSION } from './app.constants.js';
import { requestIdMiddleware } from './common/http/request-id.js';
import { requireJsonBody } from './common/http/require-json.middleware.js';
import type { Env } from './config/env.schema.js';

export const swaggerConfig = () =>
  new DocumentBuilder()
    .setTitle('Transaction Ledger API')
    .setDescription(
      'Accounts, credit/debit transactions, balances, paginated history and atomic transfers.\n\n' +
        'Money is a JSON string with two decimals. Every error uses one envelope: ' +
        '`{ "error": { status, code, message, details?, context?, request_id, timestamp, path } }`.\n\n' +
        'Transactions and transfers are immutable: any verb other than the documented one returns 405 ' +
        '`METHOD_NOT_ALLOWED` with an `Allow` header, and unknown paths return 404 `ROUTE_NOT_FOUND`.',
    )
    .setVersion(APP_VERSION)
    .build();

/**
 * Shared by main.ts, the e2e tests and the OpenAPI exporter so all three run the same HTTP stack.
 * The app must be created with `bodyParser: false`; JSON parsing is registered here, after the
 * request-id middleware, so even body-parser failures carry a request id.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(requestIdMiddleware);
  app.use(requireJsonBody);
  app.useBodyParser('json', { limit: config.get('BODY_LIMIT', { infer: true }), strict: true });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, swaggerConfig()), {
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-yaml',
    customSiteTitle: APP_NAME,
  });
}
