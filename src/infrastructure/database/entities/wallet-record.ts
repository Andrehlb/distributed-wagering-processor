import { EntitySchema } from '@mikro-orm/core';

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balanceAmount!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletRecordSchema = new EntitySchema({
  class: WalletRecord,
  tableName: 'wallets',
  properties: {
    id: {
      type: 'string',
      primary: true,
      length: 36,
    },
    playerId: {
      type: 'string',
      fieldName: 'player_id',
      length: 36,
    },
    currency: {
      type: 'string',
      length: 3,
    },
    balanceAmount: {
      type: 'decimal',
      fieldName: 'balance_amount',
      precision: 30,
      scale: 2,
    },
    version: {
      type: 'integer',
    },
    createdAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'created_at',
    },
    updatedAt: {
      type: 'datetime',
      columnType: 'timestamptz',
      fieldName: 'updated_at',
    },
  },
  uniques: [
    {
      name: 'uq_wallet_player_currency',
      properties: ['playerId', 'currency'],
    },
  ],
  checks: [
    {
      name: 'chk_wallet_finite',
      expression: "balance_amount <> 'NaN'::numeric",
    },
    {
      name: 'chk_wallet_balance_non_negative',
      expression: '"balance_amount" >= 0',
    },
    {
      name: 'chk_wallet_version_positive',
      expression: '"version" >= 1',
    },
  ],
});
