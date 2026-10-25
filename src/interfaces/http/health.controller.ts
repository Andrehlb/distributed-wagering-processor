import {
  Controller,
  Get,
  Inject,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { EntityManager } from '@mikro-orm/postgresql';
import { SqsTransport } from '../../infrastructure/messaging/sqs.js';
import { observability } from '../../infrastructure/observability/telemetry.js';
@Controller()
export class HealthController {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(SqsTransport) private readonly sqs: SqsTransport,
  ) {}
  @Get('health/live') live() {
    return { status: 'ok' };
  }
  @Get('health/ready') async ready() {
    try {
      await Promise.all([this.em.fork().execute('select 1'), this.sqs.ready()]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        code: 'DEPENDENCY_UNAVAILABLE',
      });
    }
  }
  @Get('metrics') async metrics(@Res() response: Response) {
    const lag = (
      await this.em
        .fork()
        .execute<Array<{ lag: string; pending: string }>>(
          `select coalesce(extract(epoch from now()-min(created_at)),0)::text lag,count(*)::text pending from outbox_events where status='PENDING'`,
        )
    )[0]!;
    response
      .type('text/plain')
      .send(
        observability.render() +
          `outbox_lag_seconds ${lag.lag}\noutbox_pending ${lag.pending}\n`,
      );
  }
}
