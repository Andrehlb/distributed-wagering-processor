export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly minorUnits: bigint,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    if (
      typeof props?.amount !== 'string' ||
      !/^(0|[1-9]\d*)\.\d{2}$/.test(props.amount)
    ) {
      throw new Error('INVALID_MONEY_AMOUNT');
    }

    const currency = Money.validateCurrency(props.currency);
    const [whole, fraction] = props.amount.split('.');

    const minorUnits = BigInt(whole) * 100n + BigInt(fraction);

    return new Money(minorUnits, currency);
  }

  static zero(currency: string): Money {
    return new Money(0n, Money.validateCurrency(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  negate(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits < other.minorUnits;
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency && this.minorUnits === other.minorUnits
    );
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  toString(): string {
    const absolute = this.minorUnits < 0n ? -this.minorUnits : this.minorUnits;

    const whole = absolute / 100n;
    const fraction = (absolute % 100n).toString().padStart(2, '0');

    return `${this.minorUnits < 0n ? '-' : ''}${whole}.${fraction}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error('CURRENCY_MISMATCH');
    }
  }

  private static validateCurrency(currency: string): string {
    if (
      typeof currency !== 'string' ||
      !/^[A-Z]{3}$/.test(currency) ||
      !Intl.supportedValuesOf('currency').includes(currency)
    ) {
      throw new Error('INVALID_CURRENCY');
    }

    return currency;
  }
}
