import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { observability } from '../observability/telemetry.js';
import { SqsTransport } from './sqs.js';
interface Claimed {
  id: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
  attempts: number;
}
@Injectable()
export class OutboxPublisher {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(SqsTransport) private readonly sqs: SqsTransport,
  ) {}
  async publishBatch(
    limit = 20,
    afterPublish?: () => Promise<void>,
  ): Promise<number> {
    const token = randomUUID();
    const claimed = await this.em.fork().transactional((tx) =>
      tx.execute<Claimed[]>(
        `with due as (
      select id from outbox_events where status='PENDING' and (next_attempt_at is null or next_attempt_at<=now())
      and (lease_until is null or lease_until<now()) order by created_at,id for update skip locked limit ?)
      update outbox_events o set lease_token=?,lease_until=now()+interval '60 seconds'
      from due where o.id=due.id returning o.*`,
        [limit, token],
      ),
    );
    // Renew the whole claim while sending a batch. A killed process naturally loses its lease.
    const heartbeat = setInterval(() => {
      void this.em
        .fork()
        .execute(
          "update outbox_events set lease_until=now()+interval '60 seconds' where lease_token=? and status='PENDING'",
          [token],
        )
        .catch(() =>
          observability.increment('outbox_lease_extension_failures_total'),
        );
    }, 10000);
    let published = 0;
    try {
      for (const row of claimed) {
        try {
          await this.sqs.publish(row.payload, row.aggregate_id, row.id);
          // Failure here represents a crash after publish but before marking; stable eventId makes replay deduplicable.
          if (afterPublish) await afterPublish();
          await this.em.fork().execute(
            `update outbox_events set status='PUBLISHED',published_at=now(),lease_until=null,lease_token=null
          where id=? and lease_token=? and status='PENDING'`,
            [row.id, token],
          );
          published++;
        } catch {
          const message = OutboxMessage.rehydrate({
            id: row.id,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
            occurredAt: row.created_at,
            attempts: row.attempts,
          });
          message.scheduleRetry(new Date());
          await this.em
            .fork()
            .execute(
              `update outbox_events set attempts=?,next_attempt_at=?,lease_token=null,lease_until=null where id=? and lease_token=?`,
              [message.attempts, message.nextAttemptAt, row.id, token],
            );
          observability.increment('outbox_retries_total');
          observability.log('warn', 'outbox_retry', {
            correlationId: row.payload.correlationId,
            eventId: row.id,
            walletId: row.aggregate_id,
          });
        }
      }
      return published;
    } finally {
      clearInterval(heartbeat);
    }
  }
}
