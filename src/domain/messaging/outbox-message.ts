import type { IntegrationEvent } from '../events/integration-event.js';
export interface OutboxState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}
export class OutboxMessage {
  private constructor(private readonly state: OutboxState) {}
  static enqueue(event: IntegrationEvent<Record<string, unknown>>) {
    return new OutboxMessage({
      id: event.eventId,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: event.toJSON(),
      occurredAt: event.occurredAt,
      attempts: 0,
    });
  }
  static rehydrate(state: OutboxState) {
    return new OutboxMessage({
      ...state,
      payload: structuredClone(state.payload),
    });
  }
  get id() {
    return this.state.id;
  }
  get aggregateId() {
    return this.state.aggregateId;
  }
  get eventType() {
    return this.state.eventType;
  }
  get payload() {
    return structuredClone(this.state.payload);
  }
  get attempts() {
    return this.state.attempts;
  }
  get nextAttemptAt() {
    return this.state.nextAttemptAt
      ? new Date(this.state.nextAttemptAt)
      : undefined;
  }
  get publishedAt() {
    return this.state.publishedAt
      ? new Date(this.state.publishedAt)
      : undefined;
  }
  isPending() {
    return !this.state.publishedAt;
  }
  isDue(now: Date) {
    return (
      this.isPending() &&
      (!this.state.nextAttemptAt || this.state.nextAttemptAt <= now)
    );
  }
  markPublished(at: Date) {
    if (!this.isPending()) throw new Error('OUTBOX_ALREADY_PUBLISHED');
    this.state.publishedAt = new Date(at);
  }
  scheduleRetry(now: Date) {
    if (!this.isPending()) throw new Error('OUTBOX_ALREADY_PUBLISHED');
    this.state.attempts++;
    this.state.nextAttemptAt = new Date(
      now.getTime() +
        Math.min(300_000, 1000 * 2 ** Math.min(this.state.attempts - 1, 9)),
    );
  }
}
