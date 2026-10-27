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
import { transferResponse } from '../ledger/ledger.mapper.js';
import {
  createTransferBody,
  transferIdParams,
  type CreateTransferBody,
  type TransferIdParams,
} from './transfers.schemas.js';
import { TransfersService } from './transfers.service.js';

@ApiTags('Transfers')
@Controller({ path: 'transfers', version: '1' })
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @ApiOperation({
    summary: 'Transfer money between two accounts (atomic)',
    description:
      'Debits the source and credits the destination in one database transaction. Either both legs ' +
      'are persisted or neither. Legs appear in each account history as ordinary debit/credit rows ' +
      'linked by `transfer_id`. `reference_id` is generated when omitted.',
  })
  @ApiCreatedResponse({ schema: openApiSchema(transferResponse) })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'MALFORMED_JSON',
    'ACCOUNT_NOT_FOUND',
    'DUPLICATE_TRANSFER',
    'DUPLICATE_TRANSACTION',
    'CONCURRENCY_CONFLICT',
    'INSUFFICIENT_BALANCE',
    'BALANCE_LIMIT_EXCEEDED',
    'INTERNAL_ERROR',
  )
  async create(
    @Body({ schema: createTransferBody }) body: CreateTransferBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const transfer = await this.transfers.create(body);
    res.location(`/v1/transfers/${transfer.id}`);
    return transfer;
  }

  @All()
  @ApiExcludeEndpoint()
  collectionNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['POST']);
  }

  @Get(':transfer_id')
  @ApiOperation({ summary: 'Get a transfer with both legs' })
  @ApiParam({ name: 'transfer_id', schema: { type: 'string', format: 'uuid' } })
  @ApiOkResponse({ schema: openApiSchema(transferResponse) })
  @ApiErrorResponses(
    'VALIDATION_ERROR',
    'TRANSFER_NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'INTERNAL_ERROR',
  )
  get(@Param({ schema: transferIdParams }) params: TransferIdParams) {
    return this.transfers.get(params.transfer_id);
  }

  @All(':transfer_id')
  @ApiExcludeEndpoint()
  itemNotAllowed(@Req() req: Request): never {
    throw new MethodNotAllowedError(req.method, ['GET']);
  }
}
