import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Money, type MoneyProps } from '../../domain/money/money.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind as Kind,
  WagerTransactionStatus as Status,
  LedgerDirection,
  type FailureCode,
} from '../../domain/wager-transaction/wager-transaction.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { InboxMessage } from '../../domain/messaging/inbox-message.js';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
  WalletBalanceChanged,
} from '../../domain/events/integration-event.js';
import { observability } from '../../infrastructure/observability/telemetry.js';
import { payloadHash } from '../canonical-payload.js';
import { enqueueEvent } from '../events.js';

export interface ProcessWagerInput {
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}
export interface ProcessWagerResult {
  transactionId: string;
  status: Status;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: string;
}
export interface ProcessingContext {
  correlationId?: string;
  inbox?: { consumerName: string; messageId: string };
  /** Explicit dependency used by integration tests; never accepted from HTTP or SQS. */
  beforeCommit?: () => Promise<void>;
}
interface WalletRow {
  id: string;
  player_id: string;
  currency: string;
  balance_amount: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}
export interface TransactionRow {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  idempotency_key: string;
  payload_hash: string;
  wallet_id: string;
  player_id: string;
  round_id: string;
  game_id: string;
  kind: Kind;
  status: Status;
  amount: string;
  currency: string;
  reference_external_transaction_id: string | null;
  reference_transaction_id: string | null;
  failure_code: FailureCode | null;
  balance_snapshot: string | null;
  original_response: ProcessWagerResult | null;
  created_at: Date;
  processed_at: Date | null;
  reference_attempts: number;
  correlation_id: string | null;
}
export function validateWager(input: ProcessWagerInput, key: string): Money {
  const fields: Array<[unknown, number]> = [
    [key, 150],
    [input?.providerId, 100],
    [input?.externalTransactionId, 150],
    [input?.playerId, 36],
    [input?.walletId, 36],
    [input?.roundId, 150],
    [input?.gameId, 150],
  ];
  if (
    !input ||
    !fields.every(
      ([v, max]) => typeof v === 'string' && !!v.trim() && v.length <= max,
    )
  )
    throw new Error('INVALID_WAGER_INPUT');
  if (!['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(input.kind))
    throw new Error('UNSUPPORTED_TRANSACTION_KIND');
  if (
    input.referenceExternalTransactionId !== undefined &&
    (typeof input.referenceExternalTransactionId !== 'string' ||
      !input.referenceExternalTransactionId.trim() ||
      input.referenceExternalTransactionId.length > 150)
  )
    throw new Error('INVALID_REFERENCE');
  if (
    ['REFUND', 'ROLLBACK'].includes(input.kind) &&
    !input.referenceExternalTransactionId
  )
    throw new Error('REFERENCE_REQUIRED');
  if (
    ['BET', 'LOSS'].includes(input.kind) &&
    input.referenceExternalTransactionId
  )
    throw new Error('REFERENCE_NOT_APPLICABLE');
  const amount = Money.from(input.money);
  if (!amount.isPositive()) throw new Error('INVALID_TRANSACTION_AMOUNT');
  if (amount.currency !== 'BRL') throw new Error('UNSUPPORTED_CURRENCY');
  if (amount.toString().split('.')[0]!.length > 28)
    throw new Error('AMOUNT_OUT_OF_RANGE');
  return amount;
}
function businessPayload(input: ProcessWagerInput) {
  return {
    providerId: input.providerId,
    externalTransactionId: input.externalTransactionId,
    playerId: input.playerId,
    walletId: input.walletId,
    roundId: input.roundId,
    gameId: input.gameId,
    kind: input.kind,
    money: input.money,
    ...(input.referenceExternalTransactionId
      ? { referenceExternalTransactionId: input.referenceExternalTransactionId }
      : {}),
  };
}
function rehydrate(row: TransactionRow): WagerTransaction {
  return WagerTransaction.rehydrate({
    id: row.id,
    providerId: row.provider_id,
    externalTransactionId: row.external_transaction_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    walletId: row.wallet_id,
    playerId: row.player_id,
    roundId: row.round_id,
    gameId: row.game_id,
    kind: row.kind,
    money: Money.from({ amount: row.amount, currency: row.currency }),
    referenceExternalTransactionId:
      row.reference_external_transaction_id ?? undefined,
    referenceTransactionId: row.reference_transaction_id ?? undefined,
    status: row.status,
    failureCode: row.failure_code ?? undefined,
    createdAt: row.created_at,
    processedAt: row.processed_at ?? undefined,
  });
}

@Injectable()
export class ProcessWagerUseCase {
  constructor(@Inject(EntityManager) private readonly em: EntityManager) {}

  async execute(
    input: ProcessWagerInput,
    idempotencyKey: string,
    context: ProcessingContext = {},
  ): Promise<ProcessWagerResult> {
    const amount = validateWager(input, idempotencyKey);
    const business = businessPayload({ ...input, money: amount.toJSON() });
    const hash = payloadHash(business);
    return this.em.fork().transactional(async (tx) => {
      // Identity locks precede wallet locks. No lock is shared by unrelated identities/wallets.
      const locks = [
        `key:${idempotencyKey}`,
        `external:${JSON.stringify([input.providerId, input.externalTransactionId])}`,
      ];
      if (context.inbox)
        locks.push(
          `inbox:${JSON.stringify([context.inbox.consumerName, context.inbox.messageId])}`,
        );
      for (const lock of locks.sort())
        await tx.execute(
          'select pg_advisory_xact_lock(hashtextextended(?,0))',
          [lock],
        );
      const inboxHash = payloadHash({ business, idempotencyKey });
      if (context.inbox) {
        const seen = await tx.execute<Array<{ payload_hash: string }>>(
          'select payload_hash from inbox_messages where consumer_name=? and message_id=?',
          [context.inbox.consumerName, context.inbox.messageId],
        );
        if (seen[0] && seen[0].payload_hash !== inboxHash)
          throw new Error('INBOX_PAYLOAD_CONFLICT');
      }
      const existing = await tx.execute<TransactionRow[]>(
        `select * from wager_transactions where idempotency_key=? or id in (select transaction_id from wager_idempotency_keys where idempotency_key=?) or (provider_id=? and external_transaction_id=?)`,
        [
          idempotencyKey,
          idempotencyKey,
          input.providerId,
          input.externalTransactionId,
        ],
      );
      if (existing.length) {
        const previous = existing[0]!;
        // Compatibility with pre-audit BET hashes persisted using fixed field order.
        const legacyHash =
          input.kind === 'BET' && !input.referenceExternalTransactionId
            ? createHash('sha256')
                .update(JSON.stringify(business))
                .digest('hex')
            : '';
        if (
          existing.length !== 1 ||
          (previous.payload_hash !== hash &&
            !(
              previous.original_response === null &&
              previous.payload_hash === legacyHash
            ))
        )
          throw new Error('IDEMPOTENCY_CONFLICT');
        await tx.execute(
          'insert into wager_idempotency_keys (idempotency_key,transaction_id) values (?,?) on conflict (idempotency_key) do nothing',
          [idempotencyKey, previous.id],
        );
        await this.recordInbox(tx, context, inboxHash, previous.id);
        if (context.beforeCommit) await context.beforeCommit();
        const response = previous.original_response ?? {
          transactionId: previous.id,
          status: previous.status,
          balance: {
            amount: previous.balance_snapshot!,
            currency: previous.currency,
          },
          ...(previous.failure_code
            ? { failureCode: previous.failure_code }
            : {}),
        };
        if (!response.balance.amount)
          throw new Error('MISSING_TRANSACTION_SNAPSHOT');
        return { ...response, idempotentReplay: true };
      }
      const rows = await tx.execute<WalletRow[]>(
        'select * from wallets where id=? for update',
        [input.walletId],
      );
      const row = rows[0];
      if (!row) throw new Error('WALLET_NOT_FOUND');
      if (row.player_id !== input.playerId)
        throw new Error('WALLET_PLAYER_MISMATCH');
      if (row.currency !== amount.currency)
        throw new Error('CURRENCY_MISMATCH');
      const transaction = WagerTransaction.create({
        ...businessPayload(input),
        kind: input.kind as Kind,
        id: randomUUID(),
        idempotencyKey,
        payloadHash: hash,
        money: amount,
      });
      return this.apply(tx, transaction, row, context, inboxHash);
    });
  }

  private async recordInbox(
    tx: EntityManager,
    context: ProcessingContext,
    hash: string,
    transactionId: string,
  ) {
    if (!context.inbox) return;
    const inbox = InboxMessage.receive({ ...context.inbox, payloadHash: hash });
    inbox.markProcessed(new Date());
    await tx.execute(
      `insert into inbox_messages (consumer_name,message_id,payload_hash,received_at,processed_at,transaction_id)
      values (?,?,?,?,?,?) on conflict (consumer_name,message_id) do nothing`,
      [
        inbox.consumerName,
        inbox.messageId,
        inbox.payloadHash,
        inbox.receivedAt,
        inbox.processedAt,
        transactionId,
      ],
    );
  }

  private async apply(
    tx: EntityManager,
    transaction: WagerTransaction,
    row: WalletRow,
    context: ProcessingContext,
    inboxHash?: string,
    pending?: TransactionRow,
  ): Promise<ProcessWagerResult> {
    const wallet = Wallet.rehydrate({
      id: row.id,
      playerId: row.player_id,
      currency: row.currency,
      balance: Money.from({
        amount: row.balance_amount,
        currency: row.currency,
      }),
      version: row.version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    });
    let reference: WagerTransaction | undefined;
    let pendingReference = false;
    let failure: FailureCode | undefined;
    if (transaction.referenceExternalTransactionId) {
      const refs = await tx.execute<TransactionRow[]>(
        `select * from wager_transactions where provider_id=? and external_transaction_id=?`,
        [transaction.providerId, transaction.referenceExternalTransactionId],
      );
      const ref = refs[0];
      if (
        transaction.referenceExternalTransactionId ===
        transaction.externalTransactionId
      )
        failure = 'INVALID_REFERENCE';
      else if (
        !ref ||
        [Status.Pending, Status.PendingReference].includes(ref.status)
      )
        pendingReference = true;
      else {
        reference = rehydrate(ref);
        failure = transaction.referenceFailure(reference);
        if (!failure && transaction.requiresReference()) {
          const reversed = await tx.execute<Array<{ id: string }>>(
            `select id from wager_transactions where reference_transaction_id=? and kind=? and status='PROCESSED'`,
            [reference.id, transaction.kind],
          );
          if (reversed.length) failure = 'ALREADY_REVERSED';
        }
      }
    }
    const attempts = pending ? pending.reference_attempts + 1 : 0;
    if (
      pendingReference &&
      pending &&
      (attempts >= 12 ||
        Date.now() - new Date(pending.created_at).getTime() >= 86_400_000)
    ) {
      pendingReference = false;
      failure = 'REFERENCE_NOT_FOUND';
    }
    let ledger: WalletLedgerEntry | undefined;
    if (failure) transaction.reject(failure);
    else if (pendingReference) {
      // WIN with an optional reference also waits for its referenced BET.
      transaction.markPendingReference();
    } else {
      const direction = transaction.ledgerDirectionFor(reference);
      if (
        direction === LedgerDirection.Debit &&
        wallet.balance.isLessThan(transaction.money)
      ) {
        transaction.reject(
          transaction.kind === Kind.Bet
            ? 'INSUFFICIENT_FUNDS'
            : 'ROLLBACK_INSUFFICIENT_FUNDS',
        );
      } else if (
        direction === LedgerDirection.Credit &&
        wallet.balance.add(transaction.money).toString().split('.')[0]!.length >
          28
      ) {
        transaction.reject('BALANCE_LIMIT_EXCEEDED');
      } else {
        if (direction) {
          const movement =
            direction === LedgerDirection.Debit
              ? wallet.debit(transaction.money)
              : wallet.credit(transaction.money);
          ledger = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: transaction.id,
            direction,
            money: transaction.money,
            balanceBefore: movement.balanceBefore,
            balanceAfter: movement.balanceAfter,
          });
        }
        transaction.markProcessed(reference?.id, new Date());
      }
    }
    const response: ProcessWagerResult = {
      transactionId: transaction.id,
      status: transaction.status,
      balance: wallet.balance.toJSON(),
      idempotentReplay: false,
      ...(transaction.failureCode
        ? { failureCode: transaction.failureCode }
        : {}),
    };
    const nextAttempt =
      transaction.status === Status.PendingReference
        ? new Date(
            Date.now() + Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)),
          )
        : null;
    if (pending) {
      await tx.execute(
        `update wager_transactions set status=?,reference_transaction_id=?,failure_code=?,processed_at=?,
        balance_snapshot=?,reference_attempts=?,next_attempt_at=? where id=?`,
        [
          transaction.status,
          transaction.referenceTransactionId ?? null,
          transaction.failureCode ?? null,
          transaction.processedAt ?? null,
          wallet.balance.toString(),
          attempts,
          nextAttempt,
          transaction.id,
        ],
      );
    } else {
      await tx.execute(
        `insert into wager_transactions
        (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,status,
          amount,currency,reference_external_transaction_id,reference_transaction_id,failure_code,balance_snapshot,original_response,
          created_at,processed_at,next_attempt_at,correlation_id)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?,?)`,
        [
          transaction.id,
          transaction.providerId,
          transaction.externalTransactionId,
          transaction.idempotencyKey,
          transaction.payloadHash,
          wallet.id,
          wallet.playerId,
          transaction.roundId,
          transaction.gameId,
          transaction.kind,
          transaction.status,
          transaction.money.toString(),
          transaction.money.currency,
          transaction.referenceExternalTransactionId ?? null,
          transaction.referenceTransactionId ?? null,
          transaction.failureCode ?? null,
          wallet.balance.toString(),
          JSON.stringify(response),
          transaction.createdAt,
          transaction.processedAt ?? null,
          nextAttempt,
          context.correlationId ?? transaction.id,
        ],
      );
    }
    if (!pending)
      await tx.execute(
        'insert into wager_idempotency_keys (idempotency_key,transaction_id) values (?,?)',
        [transaction.idempotencyKey, transaction.id],
      );
    if (ledger) {
      await tx.execute(
        'update wallets set balance_amount=?,version=?,updated_at=? where id=?',
        [
          wallet.balance.toString(),
          wallet.version,
          wallet.updatedAt,
          wallet.id,
        ],
      );
      await tx.execute(
        `insert into wallet_ledger_entries (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at)
        values (?,?,?,?,?,?,?,?,?)`,
        [
          ledger.id,
          wallet.id,
          transaction.id,
          ledger.direction,
          ledger.money.toString(),
          wallet.currency,
          ledger.balanceBefore.toString(),
          ledger.balanceAfter.toString(),
          ledger.createdAt,
        ],
      );
    }
    if (inboxHash)
      await this.recordInbox(tx, context, inboxHash, transaction.id);
    const eventContext = {
      aggregateId: wallet.id,
      correlationId: context.correlationId ?? transaction.id,
      causationId: context.inbox?.messageId ?? transaction.id,
    };
    const data = {
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      kind: transaction.kind,
      status: transaction.status,
      ...(transaction.failureCode
        ? { failureCode: transaction.failureCode }
        : {}),
    };
    // Waiting retries do not generate an unbounded stream of identical pending events.
    if (!pending || transaction.status !== Status.PendingReference) {
      const Event =
        transaction.status === Status.Processed
          ? WagerTransactionProcessed
          : transaction.status === Status.Rejected
            ? WagerTransactionRejected
            : WagerTransactionPendingReference;
      await enqueueEvent(tx, Event.create(data, eventContext));
    }
    if (ledger)
      await enqueueEvent(
        tx,
        WalletBalanceChanged.create(
          {
            walletId: wallet.id,
            transactionId: transaction.id,
            direction: ledger.direction,
            money: ledger.money.toJSON(),
            balanceBefore: ledger.balanceBefore.toJSON(),
            balanceAfter: ledger.balanceAfter.toJSON(),
            walletVersion: wallet.version,
          },
          eventContext,
        ),
      );
    if (context.beforeCommit) await context.beforeCommit();
    return response;
  }

  async retryPending(limit = 20): Promise<number> {
    const rows = await this.em
      .fork()
      .execute<Array<{ id: string; wallet_id: string }>>(
        `select id,wallet_id from wager_transactions
      where status='PENDING_REFERENCE' and next_attempt_at<=now() order by next_attempt_at,id limit ?`,
        [limit],
      );
    let count = 0;
    for (const row of rows) {
      await this.em.fork().transactional(async (tx) => {
        // Same wallet-first order as submission. SKIP LOCKED avoids busy wallets.
        const wallets = await tx.execute<WalletRow[]>(
          'select * from wallets where id=? for update skip locked',
          [row.wallet_id],
        );
        if (!wallets[0]) return;
        const pending = (
          await tx.execute<TransactionRow[]>(
            `select * from wager_transactions where id=? and status='PENDING_REFERENCE' and next_attempt_at<=now() for update`,
            [row.id],
          )
        )[0];
        if (!pending) return;
        await this.apply(
          tx,
          rehydrate(pending),
          wallets[0],
          { correlationId: pending.correlation_id ?? pending.id },
          undefined,
          pending,
        );
        observability.increment('reference_retries_total');
        count++;
      });
    }
    return count;
  }
}
