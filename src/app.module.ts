import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AccountsModule } from './accounts/accounts.module.js';
import { AppController } from './app.controller.js';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { ZodValidationPipe } from './common/validation/zod-validation.pipe.js';
import { type Env, validateEnv } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';
import { TransfersModule } from './transfers/transfers.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // The request-id middleware has already assigned req.id (and X-Request-Id) by now.
          genReqId: (req: IncomingMessage) => (typeof req.id === 'string' ? req.id : randomUUID()),
          autoLogging: { ignore: (req: IncomingMessage) => /^\/(health|docs)/.test(req.url ?? '') },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    DatabaseModule,
    HealthModule,
    LedgerModule,
    AccountsModule,
    TransactionsModule,
    TransfersModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
