
import { Money } from '../money/money.js';
import { LedgerDirection } from '../wager-transaction/wager-transaction.js';

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt?: Date;
}

export interface LedgerEntryState extends CreateLedgerEntryProps {
  createdAt: Date;
}

export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    private readonly _createdAt: Date,
  ) {}

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.validate(props);

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(props.createdAt ?? new Date()),
    );

    if (!entry.isBalanced()) {
      throw new Error('UNBALANCED_LEDGER_ENTRY');
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    WalletLedgerEntry.validate(state);

    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      new Date(state.createdAt),
    );
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Credit
        ? this.balanceBefore.add(this.money)
        : this.balanceBefore.subtract(this.money);

    return expected.equals(this.balanceAfter);
  }

  private static validate(props: CreateLedgerEntryProps): void {
    if (
      !props.id?.trim() ||
      !props.walletId?.trim() ||
      !props.transactionId?.trim()
    ) {
      throw new Error('INVALID_LEDGER_IDENTIFIER');
    }

    if (
      props.direction !== LedgerDirection.Credit &&
      props.direction !== LedgerDirection.Debit
    ) {
      throw new Error('INVALID_LEDGER_DIRECTION');
    }

    if (!props.money.isPositive()) {
      throw new Error('INVALID_LEDGER_AMOUNT');
    }

    const currency = props.money.currency;

    if (
      props.balanceBefore.currency !== currency ||
      props.balanceAfter.currency !== currency
    ) {
      throw new Error('CURRENCY_MISMATCH');
    }

    if (
      props.balanceBefore.isNegative() ||
      props.balanceAfter.isNegative()
    ) {
      throw new Error('NEGATIVE_LEDGER_BALANCE');
    }

    const createdAt = props.createdAt ?? new Date();

    if (!Number.isFinite(createdAt.getTime())) {
      throw new Error('INVALID_LEDGER_DATE');
    }
  }
}
