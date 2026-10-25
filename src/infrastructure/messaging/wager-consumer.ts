import { Inject, Injectable } from '@nestjs/common';
import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import {
  ProcessWagerUseCase,
  type ProcessWagerInput,
} from '../../application/use-cases/process-wager.use-case.js';
import { classifyError } from '../../interfaces/http/http-errors.js';
import { observability } from '../observability/telemetry.js';
import { SqsTransport } from './sqs.js';
interface Envelope {
  messageId: string;
  type: string;
  occurredAt: string;
  correlationId?: string;
  data: ProcessWagerInput & { idempotencyKey: string };
}
@Injectable()
export class WagerConsumer {
  constructor(
    @Inject(ProcessWagerUseCase) private readonly process: ProcessWagerUseCase,
    @Inject(SqsTransport) private readonly sqs: SqsTransport,
  ) {}
  async poll(afterCommit?: () => Promise<void>): Promise<number> {
    const QueueUrl = await this.sqs.queue('wager-transactions.fifo');
    const messages = await this.sqs.client.send(
      new ReceiveMessageCommand({
        QueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: Number(process.env.SQS_VISIBILITY_TIMEOUT ?? 30),
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    // Different wallet groups run concurrently; the database remains the ordering authority.
    await Promise.all(
      (messages.Messages ?? []).map((message) =>
        this.handle(message, QueueUrl, afterCommit),
      ),
    );
    return messages.Messages?.length ?? 0;
  }
  async handle(
    message: Message,
    QueueUrl: string,
    afterCommit?: () => Promise<void>,
  ) {
    const receipt = message.ReceiptHandle;
    if (!receipt) return;
    const attempts = Number(message.Attributes?.ApproximateReceiveCount ?? '1');
    let envelope: Envelope | undefined;
    let committed = false;
    const heartbeat = setInterval(
      () => {
        void this.sqs.client
          .send(
            new ChangeMessageVisibilityCommand({
              QueueUrl,
              ReceiptHandle: receipt,
              VisibilityTimeout: Number(
                process.env.SQS_VISIBILITY_TIMEOUT ?? 30,
              ),
            }),
          )
          .catch(() =>
            observability.increment('visibility_extension_failures_total'),
          );
      },
      Math.max(
        250,
        Math.min(
          10000,
          (Number(process.env.SQS_VISIBILITY_TIMEOUT ?? 30) * 1000) / 3,
        ),
      ),
    );
    try {
      try {
        envelope = JSON.parse(message.Body ?? '') as Envelope;
      } catch {
        throw new Error('INVALID_WAGER_INPUT');
      }
      if (
        !envelope ||
        envelope.type !== 'WagerTransactionRequested' ||
        typeof envelope.messageId !== 'string' ||
        !envelope.messageId.trim() ||
        envelope.messageId.length > 150 ||
        typeof envelope.occurredAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T/.test(envelope.occurredAt) ||
        !Number.isFinite(Date.parse(envelope.occurredAt)) ||
        !envelope.data ||
        (envelope.correlationId !== undefined &&
          (typeof envelope.correlationId !== 'string' ||
            envelope.correlationId.length > 150))
      )
        throw new Error('INVALID_WAGER_INPUT');
      const result = await observability.timed(() =>
        this.process.execute(envelope!.data, envelope!.data.idempotencyKey, {
          correlationId: envelope!.correlationId ?? envelope!.messageId,
          inbox: {
            consumerName: 'wager-processor',
            messageId: envelope!.messageId,
          },
        }),
      );
      committed = true;
      observability.increment(`transactions_total{status="${result.status}"}`);
      if (result.idempotentReplay) observability.increment('duplicates_total');
      observability.log('info', 'sqs_committed', {
        correlationId: envelope.correlationId ?? envelope.messageId,
        messageId: envelope.messageId,
        transactionId: result.transactionId,
        walletId: envelope.data.walletId,
        providerId: envelope.data.providerId,
        status: result.status,
      });
      if (afterCommit) await afterCommit();
      await this.sqs.client.send(
        new DeleteMessageCommand({ QueueUrl, ReceiptHandle: receipt }),
      );
    } catch (error) {
      const mapped = classifyError(error);
      const permanent = !committed && [400, 404, 409].includes(mapped.status);
      if (permanent || attempts >= 5) {
        // Confirm DLQ delivery before deleting the original. A crash between them permits a safe duplicate.
        await this.sqs.client.send(
          new SendMessageCommand({
            QueueUrl: await this.sqs.queue('wager-transactions-dlq.fifo'),
            MessageBody: message.Body ?? '{}',
            MessageGroupId: message.MessageId ?? 'invalid',
            MessageDeduplicationId: message.MessageId ?? crypto.randomUUID(),
          }),
        );
        observability.increment('dlq_messages_total');
        await this.sqs.client.send(
          new DeleteMessageCommand({ QueueUrl, ReceiptHandle: receipt }),
        );
      } else {
        observability.increment('message_retries_total');
        await this.sqs.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl,
            ReceiptHandle: receipt,
            VisibilityTimeout: Math.min(300, 2 ** attempts),
          }),
        );
      }
      observability.log(
        'warn',
        permanent ? 'sqs_permanent_failure' : 'sqs_retry',
        {
          correlationId:
            typeof envelope?.correlationId === 'string'
              ? envelope.correlationId.slice(0, 150)
              : typeof envelope?.messageId === 'string'
                ? envelope.messageId.slice(0, 150)
                : null,
          messageId:
            typeof envelope?.messageId === 'string' ? envelope.messageId : null,
          code: mapped.code,
          attempts,
        },
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
