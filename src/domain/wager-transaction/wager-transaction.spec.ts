
import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import {
  InvalidTransactionStateError,
  LedgerDirection,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
  type CreateWagerTransactionProps,
} from './wager-transaction.js';

const baseProps = (
  kind: WagerTransactionKind = WagerTransactionKind.Bet,
): CreateWagerTransactionProps => ({
  id: 'tx-1',
  providerId: 'provider-a',
  externalTransactionId: 'external-1',
  idempotencyKey: 'provider-a:external-1',
  payloadHash: 'hash-123',
  walletId: 'wallet-1',
  playerId: 'player-1',
  roundId: 'round-1',
  gameId: 'game-1',
  kind,
  money: Money.from({ amount: '25.00', currency: 'BRL' }),
  referenceExternalTransactionId:
    kind === WagerTransactionKind.Refund ||
    kind === WagerTransactionKind.Rollback
      ? 'external-original'
      : undefined,
});

const create = (
  kind: WagerTransactionKind = WagerTransactionKind.Bet,
): WagerTransaction =>
  WagerTransaction.create(baseProps(kind));

describe('WagerTransaction', () => {
  it('starts in PENDING', () => {
    const transaction = create();

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.isTerminal()).toBe(false);
  });

  it.each([
    WagerTransactionKind.Opening,
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ])('creates transaction kind %s', (kind) => {
    expect(create(kind).kind).toBe(kind);
  });

  it('marks a BET as PROCESSED', () => {
    const transaction = create();
    const processedAt = new Date('2026-10-24T18:00:00Z');

    transaction.markProcessed(undefined, processedAt);

    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.isTerminal()).toBe(true);
    expect(transaction.processedAt?.toISOString()).toBe(
      processedAt.toISOString(),
    );
  });

  it('requires reference for REFUND and ROLLBACK', () => {
    for (const kind of [
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ]) {
      expect(() =>
        WagerTransaction.create({
          ...baseProps(kind),
          referenceExternalTransactionId: undefined,
        }),
      ).toThrow('REFERENCE_REQUIRED');
    }
  });

  it('waits for a missing reference', () => {
    const transaction = create(WagerTransactionKind.Refund);

    transaction.markPendingReference();

    expect(transaction.status).toBe(
      WagerTransactionStatus.PendingReference,
    );

    transaction.markProcessed(
      'internal-original-id',
      new Date('2026-10-24T18:00:00Z'),
    );

    expect(transaction.referenceTransactionId).toBe(
      'internal-original-id',
    );
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
  });

  it('does not allow BET to wait for a reference', () => {
    expect(() => create().markPendingReference()).toThrow(
      'REFERENCE_NOT_APPLICABLE',
    );
  });

  it('rejects a business rule violation', () => {
    const transaction = create();

    transaction.reject('INSUFFICIENT_FUNDS');

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('records permanent infrastructure failure', () => {
    const transaction = create();

    transaction.fail('PERMANENT_INFRASTRUCTURE_ERROR');

    expect(transaction.status).toBe(WagerTransactionStatus.Failed);
    expect(transaction.isTerminal()).toBe(true);
  });

  it('prevents any transition after PROCESSED', () => {
    const transaction = create();
    transaction.markProcessed(undefined, new Date());

    expect(() => transaction.reject('INSUFFICIENT_FUNDS')).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.fail('PERMANENT_INFRASTRUCTURE_ERROR')).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.markProcessed(undefined, new Date())).toThrow(
      InvalidTransactionStateError,
    );
  });

  it('prevents transitions after REJECTED or FAILED', () => {
    const rejected = create();
    rejected.reject('INVALID_REFERENCE');

    const failed = create();
    failed.fail('PERMANENT_INFRASTRUCTURE_ERROR');

    expect(() => rejected.markProcessed(undefined, new Date())).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => failed.reject('INVALID_REFERENCE')).toThrow(
      InvalidTransactionStateError,
    );
  });

  it('detects identical and divergent payload hashes', () => {
    const transaction = create();

    expect(transaction.matchesPayload('hash-123')).toBe(true);
    expect(transaction.matchesPayload('different-hash')).toBe(false);
  });

  it('returns DEBIT for BET and CREDIT for WIN', () => {
    expect(create(WagerTransactionKind.Bet).ledgerDirectionFor()).toBe(
      LedgerDirection.Debit,
    );

    expect(create(WagerTransactionKind.Win).ledgerDirectionFor()).toBe(
      LedgerDirection.Credit,
    );
  });

  it('returns no ledger direction for LOSS', () => {
    const transaction = create(WagerTransactionKind.Loss);

    expect(transaction.affectsBalance()).toBe(false);
    expect(transaction.ledgerDirectionFor()).toBeNull();
  });

  it('reverses a processed BET direction with ROLLBACK', () => {
    const bet = create(WagerTransactionKind.Bet);
    bet.markProcessed(undefined, new Date());

    const rollback = create(WagerTransactionKind.Rollback);

    expect(rollback.ledgerDirectionFor(bet)).toBe(
      LedgerDirection.Credit,
    );
  });

  it('rejects ROLLBACK referencing an unprocessed BET', () => {
    const bet = create(WagerTransactionKind.Bet);
    const rollback = create(WagerTransactionKind.Rollback);

    expect(() => rollback.ledgerDirectionFor(bet)).toThrow(
      'INVALID_REFERENCE',
    );
  });

  it('rehydrates a previously persisted transaction', () => {
    const transaction = WagerTransaction.rehydrate({
      ...baseProps(),
      status: WagerTransactionStatus.Rejected,
      failureCode: 'INSUFFICIENT_FUNDS',
      createdAt: new Date('2026-10-24T12:00:00Z'),
    });

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe('INSUFFICIENT_FUNDS');
    expect(transaction.isTerminal()).toBe(true);
  });
});
