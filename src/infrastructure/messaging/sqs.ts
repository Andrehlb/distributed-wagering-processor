import { Injectable } from '@nestjs/common';
import {
  SQSClient,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
@Injectable()
export class SqsTransport {
  readonly client = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 12000 },
  });
  private urls = new Map<string, string>();
  async queue(name: string): Promise<string> {
    const known = this.urls.get(name);
    if (known) return known;
    const result = await this.client.send(
      new GetQueueUrlCommand({
        QueueName: (process.env.SQS_QUEUE_PREFIX ?? '') + name,
      }),
    );
    if (!result.QueueUrl) throw new Error('QUEUE_NOT_FOUND');
    this.urls.set(name, result.QueueUrl);
    return result.QueueUrl;
  }
  async ready() {
    for (const name of [
      'wager-transactions.fifo',
      'wager-transactions-dlq.fifo',
      'wager-events.fifo',
    ]) {
      const QueueUrl = await this.queue(name);
      await this.client.send(
        new GetQueueAttributesCommand({
          QueueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
    }
  }
  async publish(
    payload: Record<string, unknown>,
    aggregateId: string,
    eventId: string,
  ) {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.queue('wager-events.fifo'),
        MessageBody: JSON.stringify(payload),
        MessageGroupId: aggregateId,
        MessageDeduplicationId: eventId,
      }),
    );
  }
}
