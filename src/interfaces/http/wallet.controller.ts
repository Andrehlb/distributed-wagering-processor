import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  OpenWalletUseCase,
  type OpenWalletInput,
} from '../../application/use-cases/open-wallet.use-case.js';
import { QueryWageringUseCase } from '../../application/use-cases/query-wagering.use-case.js';
import { requestContext } from '../../infrastructure/observability/telemetry.js';
@Controller('wallets')
export class WalletController {
  constructor(
    @Inject(OpenWalletUseCase) private readonly openWallet: OpenWalletUseCase,
    @Inject(QueryWageringUseCase) private readonly query: QueryWageringUseCase,
  ) {}
  @Post() create(@Body() input: OpenWalletInput) {
    return this.openWallet.execute(
      input,
      requestContext.getStore()?.correlationId,
    );
  }
  @Get(':walletId') get(@Param('walletId') id: string) {
    return this.query.wallet(id);
  }
  @Get(':walletId/ledger') ledger(
    @Param('walletId') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.query.ledger(id, cursor, limit);
  }
  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(@Param('walletId') id: string) {
    return this.query.reconcile(id, requestContext.getStore()?.correlationId);
  }
}
