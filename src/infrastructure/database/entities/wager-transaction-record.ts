import { WalletRecord } from './wallet-record.js';
import { primaryKeyTarget } from './primary-key-target.js';

import { EntitySchema } from '@mikro-orm/core';

export class WagerTransactionRecord {
  originalResponse?: Record<string, unknown>;
  referenceAttempts!: number;
  nextAttemptAt?: Date;
  correlationId?: string;
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  status!: string;
  amount!: string;
  balanceSnapshot?: string;
  currency!: string;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  failureCode?: string;
  createdAt!: Date;
  processedAt?: Date;
}

export const WagerTransactionRecordSchema = new EntitySchema({
  class: WagerTransactionRecord,
  tableName: 'wager_transactions',
  properties: {
    originalResponse: { type: 'json', columnType: 'jsonb', nullable: true },
    referenceAttempts: { type: 'integer', default: 0 },
    nextAttemptAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      nullable: true,
    },
    correlationId: { type: 'string', length: 150, nullable: true },
    id: { type: 'string', primary: true, length: 36 },
    providerId: {
      type: 'string',
      fieldName: 'provider_id',
      length: 100,
    },
    externalTransactionId: {
      type: 'string',
      fieldName: 'external_transaction_id',
      length: 150,
    },
    idempotencyKey: {
      type: 'string',
      fieldName: 'idempotency_key',
      length: 150,
    },
    payloadHash: {
      type: 'string',
      fieldName: 'payload_hash',
      length: 128,
    },
    walletId: {
      fieldName: 'wallet_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WalletRecord),
      mapToPk: true,
      deleteRule: 'restrict',
      foreignKeyName: 'fk_wager_wallet',
      index: false,
    },
    playerId: {
      type: 'string',
      fieldName: 'player_id',
      length: 36,
    },
    roundId: {
      type: 'string',
      fieldName: 'round_id',
      length: 150,
    },
    gameId: {
      type: 'string',
      fieldName: 'game_id',
      length: 150,
    },
    kind: { type: 'string', length: 20 },
    status: { type: 'string', length: 30 },
    amount: {
      type: 'decimal',
      precision: 30,
      scale: 2,
    },
    balanceSnapshot: {
      type: 'decimal',
      fieldName: 'balance_snapshot',
      precision: 30,
      scale: 2,
      nullable: true,
    },
    currency: { type: 'string', length: 3 },
    referenceExternalTransactionId: {
      type: 'string',
      fieldName: 'reference_external_transaction_id',
      length: 150,
      nullable: true,
    },
    referenceTransactionId: {
      fieldName: 'reference_transaction_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WagerTransactionRecord),
      mapToPk: true,
      nullable: true,
      deleteRule: 'restrict',
      foreignKeyName: 'fk_wager_reference',
      index: false,
    },
    failureCode: {
      type: 'string',
      fieldName: 'failure_code',
      length: 100,
      nullable: true,
    },
    createdAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'created_at',
    },
    processedAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'processed_at',
      nullable: true,
    },
  },
  uniques: [
    {
      name: 'uq_wager_provider_external',
      properties: ['providerId', 'externalTransactionId'],
    },
    {
      name: 'uq_wager_idempotency_key',
      properties: ['idempotencyKey'],
    },
  ],
  indexes: [
    { name: 'idx_wager_wallet_created', properties: ['walletId', 'createdAt'] },
    {
      name: 'idx_wager_pending_reference',
      expression:
        "create index idx_wager_pending_reference on wager_transactions (status,created_at) where status='PENDING_REFERENCE'",
    },
    {
      name: 'idx_wager_reference_due',
      expression:
        "create index idx_wager_reference_due on wager_transactions (next_attempt_at,id) where status='PENDING_REFERENCE'",
    },
    {
      name: 'uq_wager_reversal',
      expression:
        "create unique index uq_wager_reversal on wager_transactions (reference_transaction_id,kind) where status='PROCESSED' and kind in ('REFUND','ROLLBACK')",
    },
  ],
  checks: [
    {
      name: 'chk_wager_finite',
      expression:
        "amount <> 'NaN'::numeric and (balance_snapshot is null or balance_snapshot <> 'NaN'::numeric)",
    },
    { name: 'chk_reference_attempts', expression: 'reference_attempts>=0' },
    {
      name: 'chk_wager_reference_required',
      expression:
        "kind not in ('REFUND','ROLLBACK') or reference_external_transaction_id is not null",
    },
    {
      name: 'chk_wager_rejection_code',
      expression:
        "status not in ('REJECTED','FAILED') or failure_code is not null",
    },
    {
      name: 'chk_wager_processed_time',
      expression: "status <> 'PROCESSED' or processed_at is not null",
    },
    {
      name: 'chk_wager_amount_positive',
      expression: '"amount" > 0',
    },
    {
      name: 'chk_wager_kind',
      expression:
        "\"kind\" IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')",
    },
    {
      name: 'chk_wager_status',
      expression:
        "\"status\" IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')",
    },
  ],
});
