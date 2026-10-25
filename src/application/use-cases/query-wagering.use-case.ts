import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money } from '../../domain/money/money.js';
import { observability } from '../../infrastructure/observability/telemetry.js';

@Injectable()
export class QueryWageringUseCase {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}
  async wallet(id: string) {
    const row = (
      await this.em.fork().execute<
        Array<{
          id: string;
          player_id: string;
          balance_amount: string;
          currency: string;
          version: number;
        }>
      >('select * from wallets where id=?', [id])
    )[0];
    if (!row) throw new Error('WALLET_NOT_FOUND');
    return {
      id: row.id,
      playerId: row.player_id,
      balance: { amount: row.balance_amount, currency: row.currency },
      version: row.version,
    };
  }
  async transaction(id: string, providerId?: string) {
    const row = (
      await this.em
        .fork()
        .execute<Array<Record<string, unknown>>>(
          providerId
            ? 'select * from wager_transactions where provider_id=? and external_transaction_id=?'
            : 'select * from wager_transactions where id=?',
          providerId ? [providerId, id] : [id],
        )
    )[0];
    if (!row) throw new Error('TRANSACTION_NOT_FOUND');
    return {
      transactionId: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind,
      status: row.status,
      money: { amount: row.amount, currency: row.currency },
      balance:
        row.balance_snapshot === null
          ? null
          : { amount: row.balance_snapshot, currency: row.currency },
      referenceExternalTransactionId: row.reference_external_transaction_id,
      referenceTransactionId: row.reference_transaction_id,
      failureCode: row.failure_code,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  }
  async ledger(walletId: string, cursor?: string, limitText?: string) {
    await this.wallet(walletId);
    if (limitText !== undefined && !/^(?:[1-9]|[1-9]\d|100)$/.test(limitText))
      throw new Error('INVALID_PAGINATION');
    const limit = limitText ? Number(limitText) : 50;
    let after: { walletId: string; sequence: string } | undefined;
    if (cursor) {
      try {
        after = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (
          !after ||
          after.walletId !== walletId ||
          !/^\d+$/.test(after.sequence)
        )
          throw new Error();
      } catch {
        throw new Error('INVALID_CURSOR');
      }
    }
    // Monotonic per-wallet sequence assigned under its row lock, stable even when pending transactions arrive earlier.
    const rows = await this.em.fork().execute<
      Array<{
        id: string;
        transaction_id: string;
        direction: string;
        amount: string;
        currency: string;
        balance_before: string;
        balance_after: string;
        created_at: Date;
        sequence: string;
      }>
    >('select * from wallet_ledger_entries where wallet_id=? and sequence>?::bigint order by sequence limit ?', [walletId, after?.sequence ?? '0', limit + 1]);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        direction: row.direction,
        money: { amount: row.amount, currency: row.currency },
        balanceBefore: { amount: row.balance_before, currency: row.currency },
        balanceAfter: { amount: row.balance_after, currency: row.currency },
        createdAt: row.created_at,
      })),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ walletId, sequence: last.sequence }),
            ).toString('base64url')
          : null,
    };
  }
  async reconcile(walletId: string, correlationId?: string) {
    // Single statement gives both sides the same MVCC snapshot.
    const row = (
      await this.em.fork().execute<
        Array<{
          balance_amount: string;
          currency: string;
          calculated: string;
          entries: string;
        }>
      >(
        `select w.balance_amount,w.currency,
      coalesce(sum(case when l.direction='CREDIT' then l.amount else -l.amount end),0)::numeric(30,2)::text calculated,
      count(l.id)::text entries from wallets w left join wallet_ledger_entries l on l.wallet_id=w.id
      where w.id=? group by w.id`,
        [walletId],
      )
    )[0];
    if (!row) throw new Error('WALLET_NOT_FOUND');
    const stored = Money.from({
      amount: row.balance_amount,
      currency: row.currency,
    });
    // Ledger summation may be negative if corruption predates the consistency constraints.
    const calculated = row.calculated.startsWith('-')
      ? Money.from({
          amount: row.calculated.slice(1),
          currency: row.currency,
        }).negate()
      : Money.from({ amount: row.calculated, currency: row.currency });
    const consistent = stored.equals(calculated);
    if (!consistent) {
      observability.increment('reconciliation_mismatches_total');
      observability.log('error', 'reconciliation_mismatch', {
        walletId,
        correlationId,
      });
    }
    return {
      walletId,
      storedBalance: stored.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: stored.subtract(calculated).toJSON(),
      consistent,
      checkedEntries: Number(row.entries),
    };
  }
}
