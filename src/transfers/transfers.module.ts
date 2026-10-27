import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [LedgerModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
