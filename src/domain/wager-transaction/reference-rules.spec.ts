import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import {
  WagerTransaction,
  WagerTransactionKind as K,
  WagerTransactionStatus as S,
} from './wager-transaction.js';
const create = (kind: K, overrides: Record<string, unknown> = {}) =>
  WagerTransaction.create({
    id: crypto.randomUUID(),
    providerId: 'p',
    externalTransactionId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    payloadHash: 'hash',
    walletId: 'w',
    playerId: 'player',
    roundId: 'round',
    gameId: 'game',
    kind,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    referenceExternalTransactionId: 'ref',
    ...overrides,
  });
const processed = (kind: K, overrides: Record<string, unknown> = {}) => {
  const tx = create(kind, overrides);
  tx.markProcessed('ref', new Date());
  return tx;
};
describe('financial reference rules', () => {
  it('refund reverses only a processed BET with the full amount', () => {
    const refund = create(K.Refund);
    expect(refund.referenceFailure(processed(K.Bet))).toBeUndefined();
    expect(refund.referenceFailure(create(K.Bet))).toBe('INVALID_REFERENCE');
    expect(refund.referenceFailure(processed(K.Win))).toBe('INVALID_REFERENCE');
    expect(
      refund.referenceFailure(
        processed(K.Bet, {
          money: Money.from({ amount: '9.00', currency: 'BRL' }),
        }),
      ),
    ).toBe('INVALID_REFERENCE');
  });
  it('rollback accepts BET WIN REFUND and rejects other kinds', () => {
    const rollback = create(K.Rollback);
    for (const kind of [K.Bet, K.Win, K.Refund])
      expect(rollback.referenceFailure(processed(kind))).toBeUndefined();
    for (const kind of [K.Loss, K.Opening, K.Rollback])
      expect(rollback.referenceFailure(processed(kind))).toBe(
        'INVALID_REFERENCE',
      );
  });
  it('enforces provider, wallet, player, round and currency boundaries', () => {
    const refund = create(K.Refund);
    for (const override of [
      { providerId: 'other' },
      { walletId: 'other' },
      { playerId: 'other' },
      { roundId: 'other' },
      { money: Money.from({ amount: '10.00', currency: 'USD' }) },
    ])
      expect(refund.referenceFailure(processed(K.Bet, override))).toBe(
        'INVALID_REFERENCE',
      );
  });
  it('WIN with an optional BET reference may have a different value and can wait', () => {
    const win = create(K.Win, {
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });
    expect(win.referenceFailure(processed(K.Bet))).toBeUndefined();
    win.markPendingReference();
    expect(win.status).toBe(S.PendingReference);
  });
});
