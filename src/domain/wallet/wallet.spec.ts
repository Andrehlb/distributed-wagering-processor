
import { describe, expect, it } from 'bun:test';
import { Money } from '../money/money.js';
import { Wallet } from './wallet.js';

const brl = (amount: string): Money =>
  Money.from({ amount, currency: 'BRL' });

const usd = (amount: string): Money =>
  Money.from({ amount, currency: 'USD' });

const openWallet = (initialBalance = '100.00'): Wallet =>
  Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(initialBalance),
  });

describe('Wallet', () => {
  it('opens with initial balance and version 1', () => {
    const wallet = openWallet();

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.playerId).toBe('player-1');
  });

  it('opens with zero balance', () => {
    const wallet = openWallet('0.00');

    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(1);
  });

  it('rejects negative initial balance', () => {
    expect(() =>
      Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: brl('10.00').negate(),
      }),
    ).toThrow('NEGATIVE_INITIAL_BALANCE');
  });

  it('debits balance and increments version', () => {
    const wallet = openWallet();

    const movement = wallet.debit(brl('80.00'));

    expect(movement.balanceBefore.toString()).toBe('100.00');
    expect(movement.balanceAfter.toString()).toBe('20.00');
    expect(movement.version).toBe(2);
    expect(wallet.balance.toString()).toBe('20.00');
  });

  it('credits balance and increments version', () => {
    const wallet = openWallet();

    const movement = wallet.credit(brl('25.50'));

    expect(movement.balanceBefore.toString()).toBe('100.00');
    expect(movement.balanceAfter.toString()).toBe('125.50');
    expect(wallet.version).toBe(2);
  });

  it('rejects insufficient funds without changing state', () => {
    const wallet = openWallet();

    expect(() => wallet.debit(brl('100.01'))).toThrow(
      'INSUFFICIENT_FUNDS',
    );

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('allows debiting the exact available balance', () => {
    const wallet = openWallet();

    wallet.debit(brl('100.00'));

    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(2);
  });

  it('rejects movements with different currencies', () => {
    const wallet = openWallet();

    expect(() => wallet.debit(usd('10.00'))).toThrow(
      'CURRENCY_MISMATCH',
    );

    expect(() => wallet.credit(usd('10.00'))).toThrow(
      'CURRENCY_MISMATCH',
    );

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
  });

  it('rejects negative movement amounts', () => {
    const wallet = openWallet();
    const negative = brl('10.00').negate();

    expect(() => wallet.debit(negative)).toThrow(
      'NEGATIVE_MOVEMENT_AMOUNT',
    );

    expect(() => wallet.credit(negative)).toThrow(
      'NEGATIVE_MOVEMENT_AMOUNT',
    );

    expect(wallet.balance.toString()).toBe('100.00');
  });

  it('does not increment version for zero movements', () => {
    const wallet = openWallet();
    const originalUpdatedAt = wallet.updatedAt.getTime();

    wallet.debit(brl('0.00'));
    wallet.credit(brl('0.00'));

    expect(wallet.balance.toString()).toBe('100.00');
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt.getTime()).toBe(originalUpdatedAt);
  });

  it('rehydrates without applying a movement', () => {
    const createdAt = new Date('2026-10-01T10:00:00Z');
    const updatedAt = new Date('2026-10-02T10:00:00Z');

    const wallet = Wallet.rehydrate({
      id: 'wallet-1',
      playerId: 'player-1',
      currency: 'BRL',
      balance: brl('75.00'),
      version: 5,
      createdAt,
      updatedAt,
    });

    expect(wallet.balance.toString()).toBe('75.00');
    expect(wallet.version).toBe(5);
    expect(wallet.updatedAt.toISOString()).toBe(
      '2026-10-02T10:00:00.000Z',
    );
  });

  it('rejects an invalid persisted version', () => {
    expect(() =>
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: brl('100.00'),
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow('INVALID_WALLET_VERSION');
  });

  it('rejects a persisted balance with another currency', () => {
    expect(() =>
      Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: usd('100.00'),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow('CURRENCY_MISMATCH');
  });

  it('protects updatedAt from external mutation', () => {
    const wallet = openWallet();
    const exposedDate = wallet.updatedAt;
    const originalTime = wallet.updatedAt.getTime();

    exposedDate.setFullYear(2000);

    expect(wallet.updatedAt.getTime()).toBe(originalTime);
  });
});
