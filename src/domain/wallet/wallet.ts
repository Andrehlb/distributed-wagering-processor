
import { Money } from '../money/money.js';

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WalletMovement {
  balanceBefore: Money;
  balanceAfter: Money;
  version: number;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    Wallet.assertIdentifier(props.id);
    Wallet.assertIdentifier(props.playerId);

    if (props.initialBalance.isNegative()) {
      throw new Error('NEGATIVE_INITIAL_BALANCE');
    }

    const now = new Date();

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      new Date(now),
      new Date(now),
    );
  }

  static rehydrate(state: WalletState): Wallet {
    Wallet.assertIdentifier(state.id);
    Wallet.assertIdentifier(state.playerId);

    if (state.balance.currency !== state.currency) {
      throw new Error('CURRENCY_MISMATCH');
    }

    if (state.balance.isNegative()) {
      throw new Error('NEGATIVE_WALLET_BALANCE');
    }

    if (!Number.isSafeInteger(state.version) || state.version < 1) {
      throw new Error('INVALID_WALLET_VERSION');
    }

    if (
      !Number.isFinite(state.createdAt.getTime()) ||
      !Number.isFinite(state.updatedAt.getTime())
    ) {
      throw new Error('INVALID_WALLET_DATE');
    }

    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      new Date(state.createdAt),
      new Date(state.updatedAt),
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  debit(amount: Money): WalletMovement {
    this.assertSameCurrency(amount);
    this.assertNonNegativeAmount(amount);

    if (amount.isZero()) {
      return this.currentMovement();
    }

    if (this._balance.isLessThan(amount)) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    return this.applyBalance(this._balance.subtract(amount));
  }

  credit(amount: Money): WalletMovement {
    this.assertSameCurrency(amount);
    this.assertNonNegativeAmount(amount);

    if (amount.isZero()) {
      return this.currentMovement();
    }

    return this.applyBalance(this._balance.add(amount));
  }

  private applyBalance(nextBalance: Money): WalletMovement {
    const balanceBefore = this._balance;

    this._balance = nextBalance;
    this._version += 1;
    this._updatedAt = new Date();

    return {
      balanceBefore,
      balanceAfter: this._balance,
      version: this._version,
    };
  }

  private currentMovement(): WalletMovement {
    return {
      balanceBefore: this._balance,
      balanceAfter: this._balance,
      version: this._version,
    };
  }

  private assertSameCurrency(amount: Money): void {
    if (amount.currency !== this.currency) {
      throw new Error('CURRENCY_MISMATCH');
    }
  }

  private assertNonNegativeAmount(amount: Money): void {
    if (amount.isNegative()) {
      throw new Error('NEGATIVE_MOVEMENT_AMOUNT');
    }
  }

  private static assertIdentifier(value: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('INVALID_WALLET_IDENTIFIER');
    }
  }
}
