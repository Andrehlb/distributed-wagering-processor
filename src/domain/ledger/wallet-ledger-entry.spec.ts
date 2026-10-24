
import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { LedgerDirection } from '../wager-transaction/wager-transaction.js';
import {
  WalletLedgerEntry,
  type CreateLedgerEntryProps,
} from './wallet-ledger-entry.js';

const brl = (amount: string): Money =>
  Money.from({ amount, currency: 'BRL' });

const baseProps = (): CreateLedgerEntryProps => ({
  id: 'ledger-1',
  walletId: 'wallet-1',
  transactionId: 'transaction-1',
  direction: LedgerDirection.Debit,
  money: brl('25.00'),
  balanceBefore: brl('100.00'),
  balanceAfter: brl('75.00'),
  createdAt: new Date('2026-10-24T18:00:00Z'),
});

describe('WalletLedgerEntry', () => {
  it('creates a balanced DEBIT entry', () => {
    const entry = WalletLedgerEntry.create(baseProps());

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(LedgerDirection.Debit);
    expect(entry.balanceAfter.toString()).toBe('75.00');
  });

  it('creates a balanced CREDIT entry', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      direction: LedgerDirection.Credit,
      balanceAfter: brl('125.00'),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.toString()).toBe('125.00');
  });

  it('rejects an incorrect resulting balance', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        balanceAfter: brl('80.00'),
      }),
    ).toThrow('UNBALANCED_LEDGER_ENTRY');
  });

  it('rejects a DEBIT that would produce a negative balance', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        money: brl('150.00'),
        balanceAfter: brl('0.00'),
      }),
    ).toThrow('UNBALANCED_LEDGER_ENTRY');
  });

  it('rejects negative balances', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        balanceBefore: brl('10.00').negate(),
      }),
    ).toThrow('NEGATIVE_LEDGER_BALANCE');
  });

  it('rejects zero amounts', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        money: brl('0.00'),
      }),
    ).toThrow('INVALID_LEDGER_AMOUNT');
  });

  it('rejects negative amounts', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        money: brl('25.00').negate(),
      }),
    ).toThrow('INVALID_LEDGER_AMOUNT');
  });

  it('rejects currency mismatches', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        balanceAfter: Money.from({
          amount: '75.00',
          currency: 'USD',
        }),
      }),
    ).toThrow('CURRENCY_MISMATCH');
  });

  it('rejects invalid identifiers', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        walletId: '',
      }),
    ).toThrow('INVALID_LEDGER_IDENTIFIER');
  });

  it('rejects invalid directions', () => {
    expect(() =>
      WalletLedgerEntry.create({
        ...baseProps(),
        direction: 'UNKNOWN' as LedgerDirection,
      }),
    ).toThrow('INVALID_LEDGER_DIRECTION');
  });

  it('rehydrates a persisted entry', () => {
    const entry = WalletLedgerEntry.rehydrate({
      ...baseProps(),
      createdAt: new Date('2026-10-24T18:00:00Z'),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.transactionId).toBe('transaction-1');
  });

  it('preserves the original amount', () => {
    const amount = brl('25.00');
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      money: amount,
    });

    expect(entry.money.toString()).toBe('25.00');
    expect(amount.toString()).toBe('25.00');
  });

  it('protects the creation date from external mutation', () => {
    const originalDate = new Date('2026-10-24T18:00:00Z');

    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      createdAt: originalDate,
    });

    originalDate.setFullYear(2000);

    const exposedDate = entry.createdAt;
    exposedDate.setFullYear(1999);

    expect(entry.createdAt.toISOString()).toBe(
      '2026-10-24T18:00:00.000Z',
    );
  });

  it('supports exact cent-level calculations', () => {
    const entry = WalletLedgerEntry.create({
      ...baseProps(),
      money: brl('0.10'),
      balanceBefore: brl('0.30'),
      balanceAfter: brl('0.20'),
    });

    expect(entry.isBalanced()).toBe(true);
  });
});
