import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { ProcessWagerUseCase } from '../../application/use-cases/process-wager.use-case.js';
import { WagerConsumer } from './wager-consumer.js';
import { OutboxPublisher } from './outbox-publisher.js';
import { observability } from '../observability/telemetry.js';
@Injectable()
export class Workers
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private stopped = false;
  private tasks: Promise<void>[] = [];
  constructor(
    @Inject(WagerConsumer) private readonly consumer: WagerConsumer,
    @Inject(OutboxPublisher) private readonly publisher: OutboxPublisher,
    @Inject(ProcessWagerUseCase) private readonly process: ProcessWagerUseCase,
  ) {}
  onApplicationBootstrap() {
    if (process.env.WORKERS_ENABLED !== 'true') return;
    this.tasks = [
      this.loop('consumer', () => this.consumer.poll()),
      this.loop('outbox', () => this.publisher.publishBatch()),
      this.loop('references', () => this.process.retryPending()),
    ];
  }
  private async loop(name: string, run: () => Promise<unknown>) {
    while (!this.stopped) {
      try {
        await run();
      } catch {
        observability.log('warn', 'worker_iteration_failed', { worker: name });
      }
      if (!this.stopped)
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async beforeApplicationShutdown() {
    this.stopped = true;
    await Promise.allSettled(this.tasks);
  }
}
