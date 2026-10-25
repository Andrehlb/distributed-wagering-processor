import {
  IdempotencyKeyRecordSchema,
  InboxRecordSchema,
  OutboxRecordSchema,
} from './entities/messaging-records.js';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { WalletRecordSchema } from './entities/wallet-record.js';
import { WagerTransactionRecordSchema } from './entities/wager-transaction-record.js';
import { WalletLedgerEntryRecordSchema } from './entities/wallet-ledger-entry-record.js';

const password = process.env.POSTGRES_PASSWORD;

if (!password) {
  throw new Error('POSTGRES_PASSWORD is required');
}

export default defineConfig({
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  dbName: process.env.POSTGRES_DB ?? 'wagering',
  user: process.env.POSTGRES_USER ?? 'wagering',
  password,

  entities: [
    IdempotencyKeyRecordSchema,
    InboxRecordSchema,
    OutboxRecordSchema,
    WalletRecordSchema,
    WagerTransactionRecordSchema,
    WalletLedgerEntryRecordSchema,
  ],

  // Trigger bodies and deferred constraints are versioned exclusively by migrations.
  schemaGenerator: { ignoreTriggers: true },
  discovery: {
    warnWhenNoEntities: false,
  },

  extensions: [Migrator],

  migrations: {
    path: './dist/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
    snapshot: false,
    transactional: true,
    allOrNothing: true,
  },
});
