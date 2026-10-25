import {
  ProviderIdentityPort,
  DevelopmentProviderIdentity,
} from './interfaces/http/provider-identity.port.js';
import { QueryWageringUseCase } from './application/use-cases/query-wagering.use-case.js';
import { SqsTransport } from './infrastructure/messaging/sqs.js';
import { WagerConsumer } from './infrastructure/messaging/wager-consumer.js';
import { OutboxPublisher } from './infrastructure/messaging/outbox-publisher.js';
import { Workers } from './infrastructure/messaging/workers.js';
import { HealthController } from './interfaces/http/health.controller.js';
import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';

import mikroOrmConfig from './infrastructure/database/mikro-orm.config.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { WalletController } from './interfaces/http/wallet.controller.js';
import { OpenWalletUseCase } from './application/use-cases/open-wallet.use-case.js';
import { WageringController } from './interfaces/http/wagering.controller.js';
import { ProcessWagerUseCase } from './application/use-cases/process-wager.use-case.js';

@Module({
  imports: [MikroOrmModule.forRoot(mikroOrmConfig)],
  controllers: [
    AppController,
    WalletController,
    WageringController,
    HealthController,
  ],
  providers: [
    { provide: ProviderIdentityPort, useClass: DevelopmentProviderIdentity },
    AppService,
    OpenWalletUseCase,
    ProcessWagerUseCase,
    QueryWageringUseCase,
    SqsTransport,
    WagerConsumer,
    OutboxPublisher,
    Workers,
  ],
})
export class AppModule {}
