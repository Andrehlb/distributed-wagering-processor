
import { Money } from '../money/money.js';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export enum LedgerDirection {
  Debit = 'DEBIT',
  Credit = 'CREDIT',
}

export type FailureCode =
  | 'INSUFFICIENT_FUNDS'
  | 'ROLLBACK_INSUFFICIENT_FUNDS'
  | 'REFERENCE_NOT_FOUND'
  | 'INVALID_REFERENCE'
  | 'ALREADY_REVERSED'
  | 'PAYLOAD_CONFLICT'
  | 'PERMANENT_INFRASTRUCTURE_ERROR';

export class InvalidTransactionStateError extends Error {
  constructor(status: WagerTransactionStatus) {
    super(`INVALID_TRANSACTION_STATE: ${status}`);
    this.name = 'InvalidTransactionStateError';
  }
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt?: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
}

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
  ) {}

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    const required = [
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
    ];

    if (required.some((value) => !value?.trim())) {
      throw new Error('INVALID_TRANSACTION_IDENTIFIER');
    }

    if (!Object.values(WagerTransactionKind).includes(props.kind)) {
      throw new Error('INVALID_TRANSACTION_KIND');
    }

    if (!props.money.isPositive()) {
      throw new Error('INVALID_TRANSACTION_AMOUNT');
    }

    if (
      WagerTransaction.requiresReferenceFor(props.kind) &&
      !props.referenceExternalTransactionId?.trim()
    ) {
      throw new Error('REFERENCE_REQUIRED');
    }

    const createdAt = props.createdAt ?? new Date();

    if (!Number.isFinite(createdAt.getTime())) {
      throw new Error('INVALID_TRANSACTION_DATE');
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(createdAt),
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      new Date(state.createdAt ?? new Date()),
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt ? new Date(state.processedAt) : undefined,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt
      ? new Date(this._processedAt)
      : undefined;
  }

  markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
  ): void {
    this.assertNotTerminal();

    if (!Number.isFinite(at.getTime())) {
      throw new Error('INVALID_TRANSACTION_DATE');
    }

    if (this.requiresReference() && !referenceTransactionId?.trim()) {
      throw new Error('REFERENCE_REQUIRED');
    }

    this._referenceTransactionId = referenceTransactionId;
    this._status = WagerTransactionStatus.Processed;
    this._processedAt = new Date(at);
  }

  markPendingReference(): void {
    this.assertNotTerminal();

    if (!this.requiresReference()) {
      throw new Error('REFERENCE_NOT_APPLICABLE');
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode): void {
    this.assertNotTerminal();
    this._failureCode = code;
    this._status = WagerTransactionStatus.Rejected;
  }

  fail(code: FailureCode): void {
    this.assertNotTerminal();
    this._failureCode = code;
    this._status = WagerTransactionStatus.Failed;
  }

  isTerminal(): boolean {
    return [
      WagerTransactionStatus.Processed,
      WagerTransactionStatus.Rejected,
      WagerTransactionStatus.Failed,
    ].includes(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return WagerTransaction.requiresReferenceFor(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(
    reference?: WagerTransaction,
  ): LedgerDirection | null {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Loss:
        return null;

      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new Error('REFERENCE_REQUIRED');
        }

        if (
          ![
            WagerTransactionKind.Bet,
            WagerTransactionKind.Win,
            WagerTransactionKind.Refund,
          ].includes(reference.kind)
        ) {
          throw new Error('INVALID_REFERENCE');
        }

        if (reference.status !== WagerTransactionStatus.Processed) {
          throw new Error('INVALID_REFERENCE');
        }

        const originalDirection = reference.ledgerDirectionFor();

        return originalDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
    }
  }

  private assertNotTerminal(): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this._status);
    }
  }

  private static requiresReferenceFor(
    kind: WagerTransactionKind,
  ): boolean {
    return (
      kind === WagerTransactionKind.Refund ||
      kind === WagerTransactionKind.Rollback
    );
  }
}
