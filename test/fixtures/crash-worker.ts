import { MikroORM } from '@mikro-orm/postgresql';
import config from '../../src/infrastructure/database/mikro-orm.config.js';
import { ProcessWagerUseCase } from '../../src/application/use-cases/process-wager.use-case.js';
import { SqsTransport } from '../../src/infrastructure/messaging/sqs.js';
import { WagerConsumer } from '../../src/infrastructure/messaging/wager-consumer.js';
import { OutboxPublisher } from '../../src/infrastructure/messaging/outbox-publisher.js';
const orm = await MikroORM.init(config);
const uc = new ProcessWagerUseCase(orm.em);
const sqs = new SqsTransport();
const mode = process.argv[2];
try {
  if (mode === 'before-commit') {
    const { input, key } = JSON.parse(await Bun.stdin.text());
    await uc.execute(input, key, {
      inbox: { consumerName: 'crash-test', messageId: key },
      beforeCommit: async () => {
        process.exit(72);
      },
    });
  } else if (mode === 'after-commit') {
    for (let i = 0; i < 5; i++)
      await new WagerConsumer(uc, sqs).poll(async () => {
        process.exit(71);
      });
  } else if (mode === 'after-publish') {
    await new OutboxPublisher(orm.em, sqs).publishBatch(1, async () => {
      process.exit(73);
    });
  } else if (mode === 'publish') {
    console.log(
      'published',
      await new OutboxPublisher(orm.em, sqs).publishBatch(100),
    );
  }
} finally {
  sqs.client.destroy();
  await orm.close();
}
