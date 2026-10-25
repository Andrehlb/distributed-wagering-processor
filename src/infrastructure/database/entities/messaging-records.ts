import { WagerTransactionRecord } from './wager-transaction-record.js';
import { primaryKeyTarget } from './primary-key-target.js';
import { EntitySchema } from '@mikro-orm/core';
export class InboxRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt!: Date;
  transactionId!: string;
}
export const InboxRecordSchema = new EntitySchema({
  class: InboxRecord,
  tableName: 'inbox_messages',
  properties: {
    consumerName: { type: 'string', length: 100, primary: true },
    messageId: { type: 'string', length: 150, primary: true },
    payloadHash: { type: 'string', length: 128 },
    receivedAt: { type: 'datetime', columnType: 'timestamptz' },
    processedAt: { type: 'datetime', columnType: 'timestamptz' },
    transactionId: {
      fieldName: 'transaction_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WagerTransactionRecord),
      mapToPk: true,
      deleteRule: 'no action',
      foreignKeyName: 'inbox_messages_transaction_id_fkey',
      index: false,
    },
  },
});
export class OutboxRecord {
  id!: string;
  eventType!: string;
  aggregateId!: string;
  payload!: Record<string, unknown>;
  status!: string;
  attempts!: number;
  createdAt!: Date;
  publishedAt?: Date;
  nextAttemptAt?: Date;
  leaseToken?: string;
  leaseUntil?: Date;
}
export const OutboxRecordSchema = new EntitySchema({
  class: OutboxRecord,
  tableName: 'outbox_events',
  properties: {
    id: { type: 'string', length: 36, primary: true },
    eventType: { type: 'string', length: 100 },
    aggregateId: { type: 'string', length: 36 },
    payload: { type: 'json', columnType: 'jsonb' },
    status: { type: 'string', length: 20, default: 'PENDING' },
    attempts: { type: 'integer', default: 0 },
    createdAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      defaultRaw: 'now()',
    },
    publishedAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      nullable: true,
    },
    nextAttemptAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      nullable: true,
    },
    leaseToken: { type: 'string', length: 36, nullable: true },
    leaseUntil: { type: 'datetime', columnType: 'timestamptz', nullable: true },
  },
  checks: [
    {
      name: 'chk_outbox_status',
      expression: "status in ('PENDING','PUBLISHED')",
    },
    { name: 'chk_outbox_attempts', expression: 'attempts >= 0' },
  ],
  indexes: [
    {
      name: 'idx_outbox_pending',
      expression:
        "create index idx_outbox_pending on outbox_events (created_at,id) where status='PENDING'",
    },
    {
      name: 'idx_outbox_due',
      expression:
        "create index idx_outbox_due on outbox_events (next_attempt_at,lease_until,created_at,id) where status='PENDING'",
    },
  ],
});

export class IdempotencyKeyRecord {
  idempotencyKey!: string;
  transactionId!: string;
}
export const IdempotencyKeyRecordSchema = new EntitySchema({
  class: IdempotencyKeyRecord,
  tableName: 'wager_idempotency_keys',
  properties: {
    idempotencyKey: { type: 'string', length: 150, primary: true },
    transactionId: {
      fieldName: 'transaction_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WagerTransactionRecord),
      mapToPk: true,
      deleteRule: 'restrict',
      foreignKeyName: 'wager_idempotency_keys_transaction_id_fkey',
      index: false,
    },
  },
});
