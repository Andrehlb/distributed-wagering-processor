import type { EntityManager } from '@mikro-orm/postgresql';
import type { IntegrationEvent } from '../domain/events/integration-event.js';
import { OutboxMessage } from '../domain/messaging/outbox-message.js';
export async function enqueueEvent(
  tx: EntityManager,
  event: IntegrationEvent<Record<string, unknown>>,
) {
  const message = OutboxMessage.enqueue(event);
  await tx.execute(
    `insert into outbox_events (id,event_type,aggregate_id,payload) values (?,?,?,?::jsonb)`,
    [
      message.id,
      message.eventType,
      message.aggregateId,
      JSON.stringify(message.payload),
    ],
  );
}
