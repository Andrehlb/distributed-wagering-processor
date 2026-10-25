import { WagerTransactionRecord } from './wager-transaction-record.js';
import { WalletRecord } from './wallet-record.js';
import { primaryKeyTarget } from './primary-key-target.js';

import { EntitySchema } from '@mikro-orm/core';

export class WalletLedgerEntryRecord {
  sequence!: string;
  id!: string;
  walletId!: string;
  transactionId!: string;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const WalletLedgerEntryRecordSchema = new EntitySchema({
  class: WalletLedgerEntryRecord,
  tableName: 'wallet_ledger_entries',
  properties: {
    sequence: {
      type: 'bigint',
      autoincrement: true,
      generated: 'identity',
      unique: 'uq_ledger_sequence',
    },
    id: { type: 'string', primary: true, length: 36 },
    walletId: {
      fieldName: 'wallet_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WalletRecord),
      mapToPk: true,
      deleteRule: 'restrict',
      foreignKeyName: 'fk_ledger_wallet',
      index: false,
    },
    transactionId: {
      fieldName: 'transaction_id',
      kind: 'm:1',
      entity: primaryKeyTarget(WagerTransactionRecord),
      mapToPk: true,
      deleteRule: 'restrict',
      foreignKeyName: 'fk_ledger_transaction',
      index: false,
    },
    direction: {
      type: 'string',
      length: 10,
    },
    amount: {
      type: 'decimal',
      precision: 30,
      scale: 2,
    },
    currency: {
      type: 'string',
      length: 3,
    },
    balanceBefore: {
      type: 'decimal',
      fieldName: 'balance_before',
      precision: 30,
      scale: 2,
    },
    balanceAfter: {
      type: 'decimal',
      fieldName: 'balance_after',
      precision: 30,
      scale: 2,
    },
    createdAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'created_at',
    },
  },
  uniques: [
    {
      name: 'uq_ledger_wallet_transaction',
      properties: ['walletId', 'transactionId'],
    },
  ],
  indexes: [
    {
      name: 'idx_ledger_wallet_sequence',
      properties: ['walletId', 'sequence'],
    },
    {
      name: 'idx_ledger_wallet_created',
      properties: ['walletId', 'createdAt', 'id'],
    },
  ],
  checks: [
    {
      name: 'chk_ledger_finite',
      expression:
        "amount <> 'NaN'::numeric and balance_before <> 'NaN'::numeric and balance_after <> 'NaN'::numeric",
    },
    {
      name: 'chk_ledger_amount_positive',
      expression: '"amount" > 0',
    },
    {
      name: 'chk_ledger_direction',
      expression: "\"direction\" IN ('DEBIT', 'CREDIT')",
    },
    {
      name: 'chk_ledger_balances_non_negative',
      expression: '"balance_before" >= 0 AND "balance_after" >= 0',
    },
    {
      name: 'chk_ledger_arithmetic',
      expression:
        '("direction" = \'CREDIT\' AND "balance_after" = "balance_before" + "amount") OR ' +
        '("direction" = \'DEBIT\' AND "balance_after" = "balance_before" - "amount")',
    },
  ],
});
