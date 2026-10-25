import { randomUUID } from 'node:crypto';

export interface EventContext {
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  eventId?: string;
  occurredAt?: Date;
}

export abstract class IntegrationEvent<T extends Record<string, unknown>> {
  abstract readonly eventType: string;
  readonly version = 1;
  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
  readonly data: Readonly<T>;

  protected constructor(data: T, context: EventContext) {
    this.eventId = context.eventId ?? randomUUID();
    this.aggregateId = context.aggregateId;
    this.correlationId = context.correlationId;
    this.causationId = context.causationId;
    this.occurredAt = new Date(context.occurredAt ?? new Date());
    this.data = Object.freeze(structuredClone(data));
  }

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId ? { causationId: this.causationId } : {}),
      occurredAt: this.occurredAt.toISOString(),
      data: this.data,
    };
  }
}

export class WagerTransactionProcessed extends IntegrationEvent<
  Record<string, unknown>
> {
  readonly eventType = 'WagerTransactionProcessed';
  static create(data: Record<string, unknown>, context: EventContext) {
    return new this(data, context);
  }
}
export class WagerTransactionRejected extends IntegrationEvent<
  Record<string, unknown>
> {
  readonly eventType = 'WagerTransactionRejected';
  static create(data: Record<string, unknown>, context: EventContext) {
    return new this(data, context);
  }
}
export class WagerTransactionPendingReference extends IntegrationEvent<
  Record<string, unknown>
> {
  readonly eventType = 'WagerTransactionPendingReference';
  static create(data: Record<string, unknown>, context: EventContext) {
    return new this(data, context);
  }
}
export class WalletBalanceChanged extends IntegrationEvent<
  Record<string, unknown>
> {
  readonly eventType = 'WalletBalanceChanged';
  static create(data: Record<string, unknown>, context: EventContext) {
    return new this(data, context);
  }
}
