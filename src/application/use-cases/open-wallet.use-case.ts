import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../domain/money/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../domain/wager-transaction/wager-transaction.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import {
  WalletBalanceChanged,
  WagerTransactionProcessed,
} from '../../domain/events/integration-event.js';
import { enqueueEvent } from '../events.js';
import { LedgerDirection } from '../../domain/wager-transaction/wager-transaction.js';

export interface OpenWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export interface OpenWalletOutput {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

@Injectable()
export class OpenWalletUseCase {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async execute(
    input: OpenWalletInput,
    correlationId?: string,
  ): Promise<OpenWalletOutput> {
    if (
      typeof input?.playerId !== 'string' ||
      !input.playerId.trim() ||
      input.playerId.length > 36 ||
      !input.initialBalance
    ) {
      throw new Error('INVALID_WALLET_INPUT');
    }

    const initialBalance = Money.from(input.initialBalance);
    if (initialBalance.currency !== 'BRL')
      throw new Error('UNSUPPORTED_CURRENCY');
    if (initialBalance.toString().split('.')[0]!.length > 28)
      throw new Error('AMOUNT_OUT_OF_RANGE');

    const wallet = Wallet.open({
      id: randomUUID(),
      playerId: input.playerId,
      initialBalance,
    });

    const result: OpenWalletOutput = {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };

    try {
      await this.em.fork().transactional(async (tx) => {
        await tx.execute(
          `insert into wallets
            (id, player_id, currency, balance_amount,
             version, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?)`,
          [
            wallet.id,
            wallet.playerId,
            wallet.currency,
            wallet.balance.toString(),
            wallet.version,
            wallet.createdAt,
            wallet.updatedAt,
          ],
        );

        if (initialBalance.isZero()) {
          return;
        }

        const transactionId = randomUUID();
        const now = new Date();

        const payloadHash = createHash('sha256')
          .update(
            JSON.stringify({
              playerId: wallet.playerId,
              initialBalance: initialBalance.toJSON(),
            }),
          )
          .digest('hex');

        const opening = WagerTransaction.create({
          id: transactionId,
          providerId: 'INTERNAL',
          externalTransactionId: transactionId,
          idempotencyKey: `opening:${wallet.id}`,
          payloadHash,
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: 'OPENING',
          gameId: 'WALLET',
          kind: WagerTransactionKind.Opening,
          money: initialBalance,
          createdAt: now,
        });

        opening.markProcessed(undefined, now);

        await tx.execute(
          `insert into wager_transactions
            (id, provider_id, external_transaction_id,
             idempotency_key, payload_hash, wallet_id,
             player_id, round_id, game_id, kind, status,
             amount, currency, created_at, processed_at, balance_snapshot)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            opening.id,
            opening.providerId,
            opening.externalTransactionId,
            opening.idempotencyKey,
            opening.payloadHash,
            opening.walletId,
            opening.playerId,
            opening.roundId,
            opening.gameId,
            opening.kind,
            opening.status,
            opening.money.toString(),
            opening.money.currency,
            opening.createdAt,
            opening.processedAt,
            wallet.balance.toString(),
          ],
        );

        const ledger = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: wallet.id,
          transactionId,
          direction: LedgerDirection.Credit,
          money: initialBalance,
          balanceBefore: Money.zero(wallet.currency),
          balanceAfter: wallet.balance,
          createdAt: now,
        });

        await tx.execute(
          `insert into wallet_ledger_entries
            (id, wallet_id, transaction_id, direction,
             amount, currency, balance_before,
             balance_after, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ledger.id,
            ledger.walletId,
            ledger.transactionId,
            ledger.direction,
            ledger.money.toString(),
            ledger.money.currency,
            ledger.balanceBefore.toString(),
            ledger.balanceAfter.toString(),
            ledger.createdAt,
          ],
        );

        const context = {
          aggregateId: wallet.id,
          correlationId: correlationId ?? transactionId,
          causationId: transactionId,
        };
        await enqueueEvent(
          tx,
          WagerTransactionProcessed.create(
            {
              transactionId,
              walletId: wallet.id,
              kind: opening.kind,
              status: opening.status,
            },
            context,
          ),
        );
        await enqueueEvent(
          tx,
          WalletBalanceChanged.create(
            {
              walletId: wallet.id,
              transactionId,
              direction: ledger.direction,
              money: ledger.money.toJSON(),
              balanceBefore: ledger.balanceBefore.toJSON(),
              balanceAfter: ledger.balanceAfter.toJSON(),
              walletVersion: wallet.version,
            },
            context,
          ),
        );
      });
    } catch (error: unknown) {
      const sqlState = (error as { code?: string; cause?: { code?: string } })
        .code;

      if (sqlState === '23505') {
        throw new Error('WALLET_ALREADY_EXISTS');
      }

      throw error;
    }

    return result;
  }
}
