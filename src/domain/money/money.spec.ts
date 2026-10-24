
import { describe, expect, it } from 'bun:test';
import { Money } from './money.js';

describe('Money', () => {
  it('creates an exact decimal amount', () => {
    const money = Money.from({
      amount: '25.00',
      currency: 'BRL',
    });

    expect(money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
  });

  it('adds amounts without floating-point errors', () => {
    const first = Money.from({
      amount: '0.10',
      currency: 'BRL',
    });

    const second = Money.from({
      amount: '0.20',
      currency: 'BRL',
    });

    expect(first.add(second).toString()).toBe('0.30');
  });

  it('subtracts amounts exactly', () => {
    const first = Money.from({
      amount: '100.00',
      currency: 'BRL',
    });

    const second = Money.from({
      amount: '80.00',
      currency: 'BRL',
    });

    expect(first.subtract(second).toString()).toBe('20.00');
  });

  it('supports negative internal results', () => {
    const result = Money.zero('BRL').subtract(
      Money.from({ amount: '10.00', currency: 'BRL' }),
    );

    expect(result.isNegative()).toBe(true);
    expect(result.toString()).toBe('-10.00');
    expect(result.negate().toString()).toBe('10.00');
  });

  it('identifies zero, positive and negative amounts', () => {
    const zero = Money.zero('BRL');
    const positive = Money.from({ amount: '1.00', currency: 'BRL' });
    const negative = positive.negate();

    expect(zero.isZero()).toBe(true);
    expect(positive.isPositive()).toBe(true);
    expect(negative.isNegative()).toBe(true);
    expect(negative.isLessThan(zero)).toBe(true);
  });

  it('compares values and currencies', () => {
    const first = Money.from({ amount: '25.00', currency: 'BRL' });
    const second = Money.from({ amount: '25.00', currency: 'BRL' });
    const third = Money.from({ amount: '25.00', currency: 'USD' });

    expect(first.equals(second)).toBe(true);
    expect(first.equals(third)).toBe(false);
  });

  it('rejects operations involving different currencies', () => {
    const brl = Money.from({ amount: '10.00', currency: 'BRL' });
    const usd = Money.from({ amount: '10.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow('CURRENCY_MISMATCH');
    expect(() => brl.subtract(usd)).toThrow('CURRENCY_MISMATCH');
    expect(() => brl.isLessThan(usd)).toThrow('CURRENCY_MISMATCH');
  });

  it.each([
    '',
    'NaN',
    'Infinity',
    '1e3',
    '-1.00',
    '1',
    '1.2',
    '1.234',
    '01.00',
    ' 1.00',
  ])('rejects invalid input amount: %s', (amount) => {
    expect(() =>
      Money.from({ amount, currency: 'BRL' }),
    ).toThrow('INVALID_MONEY_AMOUNT');
  });

  it('rejects invalid currency formats', () => {
    expect(() => Money.zero('brl')).toThrow('INVALID_CURRENCY');
    expect(() => Money.zero('BR')).toThrow('INVALID_CURRENCY');
    expect(() => Money.zero('BRLL')).toThrow('INVALID_CURRENCY');
  });

  it('preserves immutability after addition', () => {
    const original = Money.from({
      amount: '10.00',
      currency: 'BRL',
    });

    const updated = original.add(
      Money.from({ amount: '5.00', currency: 'BRL' }),
    );

    expect(original.toString()).toBe('10.00');
    expect(updated.toString()).toBe('15.00');
    expect(updated).not.toBe(original);
  });

  it('handles amounts larger than JavaScript safe integers', () => {
    const money = Money.from({
      amount: '9007199254740993.99',
      currency: 'BRL',
    });

    expect(money.toString()).toBe('9007199254740993.99');
  });
});
