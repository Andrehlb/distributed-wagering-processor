import { describe, expect, it } from 'bun:test';
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
} from './integration-event.js';
import { OutboxMessage } from '../messaging/outbox-message.js';
import { InboxMessage } from '../messaging/inbox-message.js';
import {
  canonicalJSON,
  payloadHash,
} from '../../application/canonical-payload.js';
describe('integration envelope and persistent delivery states', () => {
  it('canonicalizes recursive keys, omits undefined, preserves strings', () => {
    expect(
      canonicalJSON({ z: 1, a: { z: '2.00', a: 'BRL' }, ignored: undefined }),
    ).toBe('{"a":{"a":"BRL","z":"2.00"},"z":1}');
    expect(payloadHash({ b: 1, a: 2 })).toBe(payloadHash({ a: 2, b: 1 }));
    expect(payloadHash({ amount: '1.00' })).not.toBe(
      payloadHash({ amount: '2.00' }),
    );
  });
  it('serializes typed event identity, version, time and money', () => {
    const data = { money: { amount: '10.00', currency: 'BRL' } };
    const event = WalletBalanceChanged.create(data, {
      aggregateId: 'wallet',
      correlationId: 'correlation',
      causationId: 'message',
    });
    data.money.amount = '20.00';
    expect(event.toJSON().data.money).toEqual({
      amount: '10.00',
      currency: 'BRL',
    });
    expect(event.toJSON().eventType).toBe('WalletBalanceChanged');
    expect(event.toJSON().version).toBe(1);
    expect(event.toJSON().causationId).toBe('message');
  });
  it('outbox backs off, caps retry delay and preserves identity after rehydration', () => {
    const event = WagerTransactionProcessed.create(
      { transactionId: 'transaction' },
      { aggregateId: 'wallet', correlationId: 'c' },
    );
    const message = OutboxMessage.enqueue(event),
      now = new Date(0);
    message.scheduleRetry(now);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date(1000));
    expect(message.isDue(new Date(999))).toBe(false);
    expect(message.isDue(new Date(1000))).toBe(true);
    for (let i = 0; i < 20; i++) message.scheduleRetry(now);
    expect(message.nextAttemptAt).toEqual(new Date(300000));
    message.markPublished(now);
    expect(message.isDue(now)).toBe(false);
    expect(() => message.scheduleRetry(now)).toThrow(
      'OUTBOX_ALREADY_PUBLISHED',
    );
    expect(message.id).toBe(event.eventId);
  });
  it('inbox records processing once and protects timestamps', () => {
    const message = InboxMessage.receive({
      consumerName: 'consumer',
      messageId: 'message',
      payloadHash: 'hash',
    });
    expect(message.isProcessed()).toBe(false);
    const at = new Date();
    message.markProcessed(at);
    at.setTime(0);
    expect(message.processedAt?.getTime()).not.toBe(0);
    expect(() => message.markProcessed(new Date())).toThrow(
      'INBOX_ALREADY_PROCESSED',
    );
  });
});
