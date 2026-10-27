import { All, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { MethodNotAllowedError } from '../common/errors/app.exception.js';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator.js';
import { openApiSchema } from '../common/swagger/openapi-schema.js';
import { transactionResponse } from '../ledger/ledger.mapper.js';
import { z } from 'zod';
import {
  accountIdParams,
  accountResponse,
  balanceResponse,
  createAccountBody,
  historyQuery,
  type AccountIdParams,
  type CreateAccountBody,
  type HistoryQuery,
} from './accounts.schemas.js';
import { AccountsService } from './accounts.service.js';

const accountIdParam = () =>
  ApiParam({
    name: 'account_id',
    schema: { type: 'string', format: 'uuid' },
    description: 'Account id',
  });

const historyResponse = z.object({
  data: z.array(transactionResponse),
  meta: z.object({
    current_page: z.number().int(),
    page_size: z.number().int(),
    total_records: z.number().int(),
    total_pages: z.number().int(),
    has_next: z.boolean(),
    has_previous: z.boolean(),
  }),
});

/**
 * Every /accounts route lives in this one controller, each followed by its 405 fallback, so route
 * registration order can never let a catch-all shadow a real handler.
 */
@ApiTags('Accounts')
@Controller({ path: 'accounts', version: '1' })
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an account',
    description: 'The balance always starts at 0; clients cannot set it.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(accountResponse) })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'MALFORMED_JSON',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'INTERNAL_ERROR',
  )
  async create(
    @Body({ schema: createAccountBody }) body: CreateAccountBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const account = await this.accounts.create(body.name);
    res.location(`/v1/accounts/${account.id}`);
    return account;
  }

  @All()
  @ApiExcludeEndpoint()
  collectionNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['POST']);
  }

  @Get(':account_id')
  @ApiOperation({ summary: 'Get an account' })
  @accountIdParam()
  @ApiOkResponse({ schema: openApiSchema(accountResponse) })
  @ApiErrorResponses('VALIDATION_ERROR', 'ACCOUNT_NOT_FOUND', 'INTERNAL_ERROR')
  get(@Param({ schema: accountIdParams }) params: AccountIdParams) {
    return this.accounts.get(params.account_id);
  }

  @All(':account_id')
  @ApiExcludeEndpoint()
  itemNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['GET']);
  }

  @Get(':account_id/balance')
  @ApiOperation({ summary: 'Get the current balance of an account' })
  @accountIdParam()
  @ApiOkResponse({ schema: openApiSchema(balanceResponse) })
  @ApiErrorResponses('VALIDATION_ERROR', 'ACCOUNT_NOT_FOUND', 'INTERNAL_ERROR')
  balance(@Param({ schema: accountIdParams }) params: AccountIdParams) {
    return this.accounts.balance(params.account_id);
  }

  @All(':account_id/balance')
  @ApiExcludeEndpoint()
  balanceNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['GET']);
  }

  @Get(':account_id/transactions')
  @ApiOperation({
    summary: 'Transaction history (newest first)',
    description:
      'Filter by `type`; paginate with `page` (default 1) and `limit` (default 20, max 100). ' +
      'Ordered by `created_at` descending with an insertion-sequence tiebreaker.',
  })
  @accountIdParam()
  @ApiOkResponse({ schema: openApiSchema(historyResponse) })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'INVALID_PAGINATION',
    'ACCOUNT_NOT_FOUND',
    'INTERNAL_ERROR',
  )
  history(
    @Param({ schema: accountIdParams }) params: AccountIdParams,
    @Query({ schema: historyQuery }) query: HistoryQuery,
  ) {
    return this.accounts.history(params.account_id, query);
  }

  @All(':account_id/transactions')
  @ApiExcludeEndpoint()
  historyNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['GET']);
  }
}
