import { ProviderIdentityPort } from './provider-identity.port.js';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ProcessWagerUseCase,
  type ProcessWagerInput,
} from '../../application/use-cases/process-wager.use-case.js';
import { QueryWageringUseCase } from '../../application/use-cases/query-wagering.use-case.js';
import {
  observability,
  requestContext,
} from '../../infrastructure/observability/telemetry.js';
@Controller()
export class WageringController {
  constructor(
    @Inject(ProviderIdentityPort)
    private readonly identity: ProviderIdentityPort,
    @Inject(ProcessWagerUseCase)
    private readonly processWager: ProcessWagerUseCase,
    @Inject(QueryWageringUseCase) private readonly query: QueryWageringUseCase,
  ) {}
  @Post('wagering/transactions')
  async create(
    @Body() input: ProcessWagerInput,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') key?: string,
    @Headers('authorization') authorization?: string,
  ) {
    await this.identity.assertProvider(input?.providerId, authorization);
    const result = await observability.timed(() =>
      this.processWager.execute(input, key ?? '', {
        correlationId: requestContext.getStore()?.correlationId,
      }),
    );
    observability.increment(`transactions_total{status="${result.status}"}`);
    if (result.idempotentReplay) observability.increment('duplicates_total');
    observability.log('info', 'wager_result', {
      transactionId: result.transactionId,
      walletId: input.walletId,
      providerId: input.providerId,
      status: result.status,
    });
    response.status(
      result.status === 'PENDING_REFERENCE'
        ? 202
        : result.status === 'REJECTED'
          ? 422
          : 200,
    );
    return result;
  }
  @Get('wagering/transactions/:transactionId') transaction(
    @Param('transactionId') id: string,
  ) {
    return this.query.transaction(id);
  }
  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  external(
    @Param('providerId') provider: string,
    @Param('externalTransactionId') id: string,
  ) {
    return this.query.transaction(id, provider);
  }
}
