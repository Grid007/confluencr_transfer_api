import { All, Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
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
import {
  createTransactionBody,
  transactionIdParams,
  type CreateTransactionBody,
  type TransactionIdParams,
} from './transactions.schemas.js';
import { TransactionsService } from './transactions.service.js';

@ApiTags('Transactions')
@Controller({ path: 'transactions', version: '1' })
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Add a credit or debit transaction',
    description:
      'Atomically appends an immutable ledger entry and updates the account balance. ' +
      '`reference_id` is unique per account: resubmitting it returns 409 with the existing transaction and changes nothing.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(transactionResponse) })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'MALFORMED_JSON',
    'ACCOUNT_NOT_FOUND',
    'DUPLICATE_TRANSACTION',
    'CONCURRENCY_CONFLICT',
    'INSUFFICIENT_BALANCE',
    'BALANCE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
  )
  async create(
    @Body({ schema: createTransactionBody }) body: CreateTransactionBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tx = await this.transactions.create(body);
    res.location(`/v1/transactions/${tx.id}`);
    return tx;
  }

  @All()
  @ApiExcludeEndpoint()
  collectionNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['POST']);
  }

  @Get(':transaction_id')
  @ApiOperation({ summary: 'Get a transaction' })
  @ApiParam({ name: 'transaction_id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: openApiSchema(transactionResponse) })
  @ApiErrorResponses('VALIDATION_ERROR', 'TRANSACTION_NOT_FOUND', 'INTERNAL_ERROR')
  get(@Param({ schema: transactionIdParams }) params: TransactionIdParams) {
    return this.transactions.get(params.transaction_id);
  }

  @All(':transaction_id')
  @ApiExcludeEndpoint()
  itemNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['GET']);
  }
}
