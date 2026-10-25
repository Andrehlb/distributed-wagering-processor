import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerService } from '@nestjs/common';
export const requestContext = new AsyncLocalStorage<{
  correlationId: string;
}>();
class Observability {
  private counters = new Map<string, number>([
    ['duplicates_total', 0],
    ['message_retries_total', 0],
    ['reference_retries_total', 0],
    ['outbox_retries_total', 0],
    ['dlq_messages_total', 0],
    ['lock_conflicts_total', 0],
    ['processing_duration_seconds_sum', 0],
    ['processing_duration_seconds_count', 0],
    ...['PROCESSED', 'REJECTED', 'PENDING_REFERENCE', 'FAILED'].map(
      (status) =>
        [`transactions_total{status="${status}"}`, 0] as [string, number],
    ),
  ]);
  increment(name: string, value = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }
  log(level: string, event: string, fields: Record<string, unknown> = {}) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        messageId: null,
        transactionId: null,
        walletId: null,
        providerId: null,
        ...fields,
        correlationId:
          fields.correlationId ??
          requestContext.getStore()?.correlationId ??
          null,
      }),
    );
  }
  async timed<T>(callback: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await callback();
    } finally {
      this.increment(
        'processing_duration_seconds_sum',
        (performance.now() - started) / 1000,
      );
      this.increment('processing_duration_seconds_count');
    }
  }
  render() {
    return (
      [...this.counters]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k} ${v}`)
        .join('\n') + '\n'
    );
  }
}
export const observability = new Observability();
export class JsonLogger implements LoggerService {
  log(message: unknown) {
    if (typeof message === 'string')
      observability.log('info', 'application', { message });
  }
  error(_message: unknown) {
    observability.log('error', 'application_error');
  }
  warn(message: unknown) {
    if (typeof message === 'string')
      observability.log('warn', 'application_warning', { message });
  }
  debug() {}
  verbose() {}
}
