import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { OpenWalletUseCase } from '../src/application/use-cases/open-wallet.use-case.js';
import {
  ProcessWagerUseCase,
  type ProcessWagerInput,
  type ProcessWagerResult,
} from '../src/application/use-cases/process-wager.use-case.js';
import { QueryWageringUseCase } from '../src/application/use-cases/query-wagering.use-case.js';
import { SqsTransport } from '../src/infrastructure/messaging/sqs.js';
import { WagerConsumer } from '../src/infrastructure/messaging/wager-consumer.js';
import { OutboxPublisher } from '../src/infrastructure/messaging/outbox-publisher.js';

async function rejects(action: Promise<unknown>, message?: string) {
  let failure: unknown;
  try {
    await action;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  if (message) expect((failure as Error).message).toContain(message);
}

const integration =
  process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
integration('real PostgreSQL + SQS + three Bun processes', () => {
  let orm: MikroORM;
  let open: OpenWalletUseCase;
  let uc: ProcessWagerUseCase;
  let query: QueryWageringUseCase;
  let sqs: SqsTransport;
  let consumer: WagerConsumer;
  let publisher: OutboxPublisher;
  let queue: string;
  let dlq: string;
  const processes: ReturnType<typeof Bun.spawn>[] = [];
  const output: Promise<string>[] = [];
  const ports = [0, 1, 2].map((i) => 34000 + (process.pid % 1000) * 3 + i);
  const env: Record<string, string> = {};
  const money = (amount: string) => ({ amount, currency: 'BRL' });
  const wallet = () =>
    open.execute({ playerId: randomUUID(), initialBalance: money('100.00') });
  const input = (
    w: { id: string; playerId: string },
    kind = 'BET',
    amount = '10.00',
    reference?: string,
  ): ProcessWagerInput => ({
    providerId: 'integration',
    externalTransactionId: randomUUID(),
    walletId: w.id,
    playerId: w.playerId,
    roundId: 'round',
    gameId: 'game',
    kind,
    money: money(amount),
    ...(reference ? { referenceExternalTransactionId: reference } : {}),
  });
  const sql = <T extends object = Record<string, unknown>>(
    q: string,
    p: unknown[] = [],
  ) => orm.em.fork().execute<T[]>(q, p);
  const post = async (data: ProcessWagerInput, key: string, index = 0) => {
    const response = await fetch(
      `http://127.0.0.1:${ports[index]}/wagering/transactions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-correlation-id': 'integration-correlation',
        },
        body: JSON.stringify(data),
      },
    );
    return {
      status: response.status,
      body: (await response.json()) as ProcessWagerResult,
    };
  };
  function spawnApi(index: number, workers = false) {
    const child = Bun.spawn([process.execPath, 'src/main.ts'], {
      env: {
        ...env,
        PORT: String(ports[index]),
        WORKERS_ENABLED: workers ? 'true' : 'false',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    processes[index] = child;
    output.push(
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    );
    return child;
  }
  async function waitApi(index: number) {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${ports[index]}/health/live`)).ok)
          return;
      } catch {}
      if (processes[index]!.exitCode !== null)
        throw new Error('API exited before readiness; child logs are collected during cleanup');
      await Bun.sleep(100);
    }
    throw new Error('API startup timeout');
  }
  async function child(mode: string, data?: unknown) {
    const p = Bun.spawn(
      [process.execPath, 'test/fixtures/crash-worker.ts', mode],
      {
        env,
        stdin: data ? new Blob([JSON.stringify(data)]) : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      p.exited,
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    if (![0, 71, 72, 73].includes(code))
      throw new Error(`child ${mode} failed: ${stderr} ${stdout}`);
    return code;
  }
  async function send(
    data: ProcessWagerInput,
    key: string,
    messageId = randomUUID(),
  ) {
    await sqs.client.send(
      new SendMessageCommand({
        QueueUrl: queue,
        MessageBody: JSON.stringify({
          messageId,
          type: 'WagerTransactionRequested',
          occurredAt: new Date().toISOString(),
          correlationId: 'queue-correlation',
          data: { ...data, idempotencyKey: key },
        }),
        MessageGroupId: data.walletId,
        MessageDeduplicationId: randomUUID(),
      }),
    );
    return messageId;
  }
  async function receive(QueueUrl = queue) {
    return (
      await sqs.client.send(
        new ReceiveMessageCommand({
          QueueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 2,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        }),
      )
    ).Messages?.[0];
  }
  async function count(
    table: string,
    where: string = '',
    args: unknown[] = [],
  ) {
    return Number(
      (
        await sql<{ n: string }>(
          `select count(*)::text n from ${table} ${where}`,
          args,
        )
      )[0]!.n,
    );
  }
  async function due() {
    await sql(
      "update wager_transactions set next_attempt_at=now()-interval '1 second' where status='PENDING_REFERENCE'",
    );
  }

  beforeAll(async () => {
    const { default: config } =
      await import('../src/infrastructure/database/mikro-orm.config.js');
    const admin = await MikroORM.init(config);
    const database = 'wagering_test_' + Date.now() + '_' + process.pid;
    await admin.em.fork().execute(`create database "${database}"`);
    await admin.close();
    process.env.SQS_QUEUE_PREFIX = 'it-' + randomUUID().slice(0, 8) + '-';
    orm = await MikroORM.init({ ...config, dbName: database });
    await orm.migrator.up();
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined) env[k] = v;
    env.POSTGRES_DB = database;
    env.SQS_VISIBILITY_TIMEOUT = '2';
    console.log(
      'isolated_database',
      database,
      'queue_prefix',
      process.env.SQS_QUEUE_PREFIX,
    );
    open = new OpenWalletUseCase(orm.em);
    uc = new ProcessWagerUseCase(orm.em);
    query = new QueryWageringUseCase(orm.em);
    sqs = new SqsTransport();
    const dlqResult = await sqs.client.send(
      new CreateQueueCommand({
        QueueName: process.env.SQS_QUEUE_PREFIX + 'wager-transactions-dlq.fifo',
        Attributes: { FifoQueue: 'true' },
      }),
    );
    dlq = dlqResult.QueueUrl!;
    const attrs = await sqs.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: dlq,
        AttributeNames: ['QueueArn'],
      }),
    );
    queue = (
      await sqs.client.send(
        new CreateQueueCommand({
          QueueName: process.env.SQS_QUEUE_PREFIX + 'wager-transactions.fifo',
          Attributes: {
            FifoQueue: 'true',
            VisibilityTimeout: '2',
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: attrs.Attributes!.QueueArn,
              maxReceiveCount: '5',
            }),
          },
        }),
      )
    ).QueueUrl!;
    await sqs.client.send(
      new CreateQueueCommand({
        QueueName: process.env.SQS_QUEUE_PREFIX + 'wager-events.fifo',
        Attributes: { FifoQueue: 'true' },
      }),
    );
    consumer = new WagerConsumer(uc, sqs);
    publisher = new OutboxPublisher(orm.em, sqs);
    for (let i = 0; i < 3; i++) spawnApi(i);
    await Promise.all(ports.map((_, i) => waitApi(i)));
  }, 30000);

  afterEach(async () => {
    if (!orm) return;
    expect(
      await sql(`select w.id from wallets w left join wallet_ledger_entries l on l.wallet_id=w.id
      group by w.id having w.balance_amount<>coalesce(sum(case when l.direction='CREDIT' then l.amount else -l.amount end),0)`),
    ).toHaveLength(0);
  });
  afterAll(async () => {
    for (const p of processes) if (p.exitCode === null) p.kill('SIGTERM');
    await Promise.all(processes.map((p) => p.exited));
    const logs = (await Promise.all(output)).join('');
    if (logs.includes('Error:')) console.log('child_errors', logs.slice(-5000));
    sqs?.client.destroy();
    await orm?.close();
    // Retain isolated database/queues as evidence. No production data is deleted.
  }, 20000);

  it('migrations up/down, SQL invariants, metadata match', async () => {
    expect(await orm.schema.getUpdateSchemaSQL({ wrap: false })).toBe('');
    await orm.migrator.down({ to: 0 });
    await orm.migrator.up();
    expect(await orm.schema.getUpdateSchemaSQL({ wrap: false })).toBe('');
    const w = await wallet();
    await rejects(
      sql('update wallets set balance_amount=-1 where id=?', [w.id]),
    );
    await rejects(
      sql('update wallets set balance_amount=99,version=version+1 where id=?', [
        w.id,
      ]),
    );
    await rejects(
      sql('update wallets set version=version+1 where id=?', [w.id]),
    );
    await rejects(
      sql('update wallet_ledger_entries set amount=amount where wallet_id=?', [
        w.id,
      ]),
    );
    await rejects(
      sql('delete from wallet_ledger_entries where wallet_id=?', [w.id]),
    );
    await rejects(sql('truncate wallet_ledger_entries'));
    await rejects(
      open.execute({ playerId: w.playerId, initialBalance: money('0.00') }),
      'WALLET_ALREADY_EXISTS',
    );
    await rejects(
      sql("update wager_transactions set status='REJECTED' where wallet_id=?", [
        w.id,
      ]),
    );
    expect((await query.wallet(w.id)).balance).toEqual(money('100.00'));
  });

  it('one debit for 50 simultaneous submissions across three processes', async () => {
    expect(new Set(processes.map((p) => p.pid)).size).toBe(3);
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => post(data, key, i % 3)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.transactionId)).size).toBe(1);
    expect(results.filter((r) => !r.body.idempotentReplay)).toHaveLength(1);
    expect((await query.wallet(w.id)).balance).toEqual(money('90.00'));
    expect(
      await count(
        'wallet_ledger_entries',
        "where wallet_id=? and direction='DEBIT'",
        [w.id],
      ),
    ).toBe(1);
  }, 15000);

  it('two 80.00 bets against 100.00 approve exactly one; replay preserves snapshot', async () => {
    const w = await wallet();
    const a = input(w, 'BET', '80.00'),
      b = input(w, 'BET', '80.00');
    const results = await Promise.all([
      post(a, a.externalTransactionId, 0),
      post(b, b.externalTransactionId, 1),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 422,
    ]);
    expect((await query.wallet(w.id)).balance).toEqual(money('20.00'));
    const win = input(w, 'WIN', '10.00');
    await post(win, win.externalTransactionId, 2);
    const replay = await post(a, a.externalTransactionId, 1);
    expect(replay.body.balance).toEqual(money('20.00'));
    expect(replay.body.idempotentReplay).toBe(true);
    expect(
      await count(
        'wallet_ledger_entries',
        "where wallet_id=? and direction='DEBIT'",
        [w.id],
      ),
    ).toBe(1);
  });

  it('different wallets run concurrently while another wallet is locked', async () => {
    const hot = await wallet();
    const others = await Promise.all(Array.from({ length: 8 }, () => wallet()));
    let release!: () => void, locked!: () => void;
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const lock = orm.em.fork().transactional(async (tx) => {
      await tx.execute('select id from wallets where id=? for update', [
        hot.id,
      ]);
      locked();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await acquired;
    let completed = false;
    const blocked = post(input(hot), randomUUID(), 0).then((r) => {
      completed = true;
      return r;
    });
    try {
      const responses = await Promise.all(
        others.map((w, i) => post(input(w), randomUUID(), i % 3)),
      );
      expect(responses.every((r) => r.status === 200)).toBe(true);
      expect(completed).toBe(false);
    } finally {
      release();
      await lock;
      await blocked;
    }
  });

  it('canonical replay, divergent key conflict, global identity race across wallets', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    const first = await post(data, key);
    const reordered = { ...data, money: { currency: 'BRL', amount: '10.00' } };
    expect((await post(reordered, key, 1)).body.transactionId).toBe(
      first.body.transactionId,
    );
    expect(
      (await post({ ...data, money: money('11.00') }, key, 2)).status,
    ).toBe(409);
    const other = await wallet(),
      raceKey = randomUUID();
    const results = await Promise.all([
      post(input(w), raceKey, 0),
      post(input(other), raceKey, 1),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
  });

  it('new keys used for an external-ID replay remain bound permanently', async () => {
    const w = await wallet(),
      data = input(w),
      originalKey = randomUUID(),
      alias = randomUUID();
    const original = await post(data, originalKey);
    const replay = await post(data, alias, 1);
    expect(replay.body.transactionId).toBe(original.body.transactionId);
    expect(replay.body.idempotentReplay).toBe(true);
    expect((await post(input(w), alias, 2)).status).toBe(409);
    expect(
      await count('wager_idempotency_keys', 'where transaction_id=?', [
        original.body.transactionId,
      ]),
    ).toBe(2);
  });

  it('SQL enforces ledger uniqueness/arithmetic, foreign keys and reversal uniqueness', async () => {
    const w = await wallet(),
      bet = input(w, 'BET', '10.00');
    const result = await uc.execute(bet, randomUUID());
    async function fails(query: string, args: unknown[], state: string) {
      let failure: unknown;
      try {
        await sql(query, args);
      } catch (error) {
        failure = error;
      }
      expect((failure as { code?: string })?.code).toBe(state);
    }
    const clone = `insert into wallet_ledger_entries (id,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at)
      select ?,wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at from wallet_ledger_entries where transaction_id=?`;
    await fails(clone, [randomUUID(), result.transactionId], '23505');
    await fails(
      clone.replace(
        'balance_after,created_at from',
        'balance_after+1,created_at from',
      ),
      [randomUUID(), result.transactionId],
      '23514',
    );
    await fails(
      clone.replace(
        'wallet_id,transaction_id,direction,amount,currency,balance_before,balance_after,created_at from',
        "wallet_id,'missing',direction,amount,currency,balance_before,balance_after,created_at from",
      ),
      [randomUUID(), result.transactionId],
      '23503',
    );
    const refund = await uc.execute(
      input(w, 'REFUND', '10.00', bet.externalTransactionId),
      randomUUID(),
    );
    await fails(
      `insert into wager_transactions (id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,
      kind,status,amount,currency,reference_external_transaction_id,reference_transaction_id,balance_snapshot,created_at,processed_at)
      select ?,provider_id,?,?,payload_hash,wallet_id,player_id,round_id,game_id,kind,status,amount,currency,
      reference_external_transaction_id,reference_transaction_id,balance_snapshot,created_at,processed_at from wager_transactions where id=?`,
      [randomUUID(), randomUUID(), randomUUID(), refund.transactionId],
      '23505',
    );
  });

  it('WIN LOSS REFUND ROLLBACK, reference validation and double reversal', async () => {
    const w = await wallet(),
      bet = input(w, 'BET', '20.00');
    await uc.execute(bet, randomUUID());
    const loss = input(w, 'LOSS', '20.00');
    const before = await query.wallet(w.id);
    await uc.execute(loss, randomUUID());
    expect(await query.wallet(w.id)).toEqual(before);
    const refund = input(w, 'REFUND', '20.00', bet.externalTransactionId);
    expect((await uc.execute(refund, randomUUID())).balance).toEqual(
      money('100.00'),
    );
    expect(
      (
        await uc.execute(
          input(w, 'REFUND', '20.00', bet.externalTransactionId),
          randomUUID(),
        )
      ).failureCode,
    ).toBe('ALREADY_REVERSED');
    expect(
      (
        await uc.execute(
          input(w, 'REFUND', '19.00', bet.externalTransactionId),
          randomUUID(),
        )
      ).failureCode,
    ).toBe('INVALID_REFERENCE');
    expect(
      (
        await uc.execute(
          input(w, 'ROLLBACK', '20.00', refund.externalTransactionId),
          randomUUID(),
        )
      ).balance,
    ).toEqual(money('80.00'));
    expect(
      (
        await uc.execute(
          input(w, 'ROLLBACK', '20.00', bet.externalTransactionId),
          randomUUID(),
        )
      ).balance,
    ).toEqual(money('100.00'));
    const win = input(w, 'WIN', '30.00');
    await uc.execute(win, randomUUID());
    expect(
      (
        await uc.execute(
          input(w, 'REFUND', '30.00', win.externalTransactionId),
          randomUUID(),
        )
      ).failureCode,
    ).toBe('INVALID_REFERENCE');
    expect(
      (
        await uc.execute(
          input(w, 'ROLLBACK', '30.00', win.externalTransactionId),
          randomUUID(),
        )
      ).balance,
    ).toEqual(money('100.00'));
    const wrong = input(w, 'REFUND', '20.00', bet.externalTransactionId);
    wrong.roundId = 'other';
    expect((await uc.execute(wrong, randomUUID())).failureCode).toBe(
      'INVALID_REFERENCE',
    );
    expect(
      await count(
        'wallet_ledger_entries',
        "where transaction_id in (select id from wager_transactions where wallet_id=? and (kind='LOSS' or status='REJECTED'))",
        [w.id],
      ),
    ).toBe(0);
  });

  it('rejects a rollback that would overdraw with a distinct failure code', async () => {
    const w = await wallet(),
      win = input(w, 'WIN', '50.00');
    await uc.execute(win, randomUUID());
    await uc.execute(input(w, 'BET', '140.00'), randomUUID());
    const result = await uc.execute(
      input(w, 'ROLLBACK', '50.00', win.externalTransactionId),
      randomUUID(),
    );
    expect(result.failureCode).toBe('ROLLBACK_INSUFFICIENT_FUNDS');
    expect(result.balance).toEqual(money('10.00'));
  });

  it('REFUND and ROLLBACK before reference resolve later, preserving original acceptance', async () => {
    for (const kind of ['REFUND', 'ROLLBACK']) {
      const w = await wallet(),
        bet = input(w, 'BET', '20.00');
      const reversal = input(w, kind, '20.00', bet.externalTransactionId);
      const key = randomUUID();
      const accepted = await post(reversal, key);
      expect(accepted.status).toBe(202);
      await uc.execute(bet, randomUUID());
      await due();
      await uc.retryPending();
      expect(
        (await query.transaction(accepted.body.transactionId)).status,
      ).toBe('PROCESSED');
      expect((await query.wallet(w.id)).balance).toEqual(money('100.00'));
      const replay = await post(reversal, key, 2);
      expect(replay.status).toBe(202);
      expect(replay.body.idempotentReplay).toBe(true);
      expect(replay.body.balance).toEqual(accepted.body.balance);
    }
  });

  it('missing reference expires auditably and emits rejected event', async () => {
    const w = await wallet();
    const result = await uc.execute(
      input(w, 'REFUND', '10.00', 'never-exists'),
      randomUUID(),
    );
    await sql(
      "update wager_transactions set reference_attempts=11,next_attempt_at=now()-interval '1 second' where id=?",
      [result.transactionId],
    );
    await uc.retryPending();
    expect((await query.transaction(result.transactionId)).failureCode).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(
      await count(
        'outbox_events',
        "where event_type='WagerTransactionRejected' and payload->'data'->>'transactionId'=?",
        [result.transactionId],
      ),
    ).toBe(1);
  });

  it('atomic wallet/transaction/ledger/inbox/outbox rollback on failure before commit', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    const events = await count('outbox_events');
    await rejects(
      uc.execute(data, key, {
        inbox: { consumerName: 'atomic', messageId: key },
        beforeCommit: async () => {
          throw new Error('FAIL_BEFORE_COMMIT');
        },
      }),
      'FAIL_BEFORE_COMMIT',
    );
    expect((await query.wallet(w.id)).balance).toEqual(money('100.00'));
    expect(
      await count('wager_transactions', 'where idempotency_key=?', [key]),
    ).toBe(0);
    expect(await count('inbox_messages', 'where message_id=?', [key])).toBe(0);
    expect(await count('outbox_events')).toBe(events);
    expect(
      await count('wallet_ledger_entries', 'where wallet_id=?', [w.id]),
    ).toBe(1);
  });

  it('real process death before commit rolls back every write', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    expect(await child('before-commit', { input: data, key })).toBe(72);
    expect((await query.wallet(w.id)).balance).toEqual(money('100.00'));
    expect(
      await count('wager_transactions', 'where idempotency_key=?', [key]),
    ).toBe(0);
    expect(await count('inbox_messages', 'where message_id=?', [key])).toBe(0);
  });

  it('SQS persistent inbox handles redelivery and detects changed envelope identity', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID(),
      messageId = await send(data, key);
    await consumer.poll();
    await send(data, key, messageId);
    await consumer.poll();
    expect(
      await count('inbox_messages', 'where message_id=?', [messageId]),
    ).toBe(1);
    expect((await query.wallet(w.id)).balance).toEqual(money('90.00'));
    const changed = { ...data, money: money('12.00') };
    await send(changed, key, messageId);
    await consumer.poll();
    const bad = await receive(dlq);
    expect(bad).toBeDefined();
    if (bad?.ReceiptHandle)
      await sqs.client.send(
        new DeleteMessageCommand({
          QueueUrl: dlq,
          ReceiptHandle: bad.ReceiptHandle,
        }),
      );
  }, 10000);

  it('worker killed after commit before ACK is recovered by another process', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    await send(data, key);
    expect(await child('after-commit')).toBe(71);
    expect((await query.wallet(w.id)).balance).toEqual(money('90.00'));
    const redelivered = await receive();
    // Crash leaves the broker receipt invisible; make it visible using a test-specific receive after timeout.
    if (!redelivered) await Bun.sleep(2200);
    await consumer.poll();
    expect((await query.wallet(w.id)).balance).toEqual(money('90.00'));
    expect(
      await count('wager_transactions', 'where idempotency_key=?', [key]),
    ).toBe(1);
    expect(await receive()).toBeUndefined();
  }, 40000);

  it('transient failures back off; malformed messages and exhausted retries reach DLQ', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    await send(data, key);
    const m = await receive();
    expect(m).toBeDefined();
    await consumer.handle(m!, queue, async () => {
      throw new Error('ACK_TRANSPORT_FAILURE');
    });
    expect(await receive()).toBeUndefined();
    await sqs.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queue,
        ReceiptHandle: m!.ReceiptHandle!,
        VisibilityTimeout: 0,
      }),
    );
    for (let n = 0; n < 5; n++) {
      const retry = await receive();
      if (!retry) break;
      await consumer.handle(retry, queue, async () => {
        throw new Error('ACK_TRANSPORT_FAILURE');
      });
      try {
        await sqs.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queue,
            ReceiptHandle: retry.ReceiptHandle!,
            VisibilityTimeout: 0,
          }),
        );
      } catch {}
    }
    const failed = await receive(dlq);
    expect(failed).toBeDefined();
    if (failed?.ReceiptHandle)
      await sqs.client.send(
        new DeleteMessageCommand({
          QueueUrl: dlq,
          ReceiptHandle: failed.ReceiptHandle,
        }),
      );
    await sqs.client.send(
      new SendMessageCommand({
        QueueUrl: queue,
        MessageBody: 'invalid json',
        MessageGroupId: 'invalid',
        MessageDeduplicationId: randomUUID(),
      }),
    );
    await consumer.poll();
    expect(await receive(dlq)).toBeDefined();
    expect((await query.wallet(w.id)).balance).toEqual(money('90.00'));
  }, 12000);

  it('SQS rejection commits audit and inbox before ACK without a debit', async () => {
    const w = await wallet(),
      data = input(w, 'BET', '180.00'),
      key = randomUUID();
    const messageId = await send(data, key);
    await consumer.poll();
    expect(
      await count('inbox_messages', 'where message_id=?', [messageId]),
    ).toBe(1);
    const transaction = (
      await sql<{ id: string; status: string; failure_code: string }>(
        'select id,status,failure_code from wager_transactions where idempotency_key=?',
        [key],
      )
    )[0]!;
    expect(transaction.status).toBe('REJECTED');
    expect(transaction.failure_code).toBe('INSUFFICIENT_FUNDS');
    expect(
      await count('wallet_ledger_entries', 'where transaction_id=?', [
        transaction.id,
      ]),
    ).toBe(0);
    expect(await receive()).toBeUndefined();
  });

  it('publisher cannot observe uncommitted events; SQS outage schedules a persistent retry', async () => {
    while (await publisher.publishBatch(100)) {}
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    const result = await uc.execute(data, key, {
      beforeCommit: async () => {
        expect(
          await count('wager_transactions', 'where idempotency_key=?', [key]),
        ).toBe(0);
        await publisher.publishBatch(100);
      },
    });
    expect(
      await count(
        'outbox_events',
        "where payload->'data'->>'transactionId'=? and status='PENDING'",
        [result.transactionId],
      ),
    ).toBe(2);
    const endpoint = process.env.SQS_ENDPOINT;
    process.env.SQS_ENDPOINT = 'http://127.0.0.1:1';
    const offline = new SqsTransport();
    if (endpoint === undefined) delete process.env.SQS_ENDPOINT;
    else process.env.SQS_ENDPOINT = endpoint;
    try {
      expect(await new OutboxPublisher(orm.em, offline).publishBatch(1)).toBe(
        0,
      );
      expect(
        await count(
          'outbox_events',
          "where attempts>0 and next_attempt_at>now() and status='PENDING'",
        ),
      ).toBe(1);
    } finally {
      offline.client.destroy();
    }
    await sql(
      "update outbox_events set next_attempt_at=now()-interval '1 second' where status='PENDING'",
    );
    while (await publisher.publishBatch(100)) {}
    expect(await count('outbox_events', "where status='PENDING'")).toBe(0);
    await wallet(); // Leave committed events for the publisher-crash scenario.
  }, 15000);

  it('two publisher processes publish outbox; crash after publish recovers stable eventId', async () => {
    expect(await child('after-publish')).toBe(73);
    const lease = (
      await sql<{ id: string; payload: { eventId: string } }>(
        'select id,payload from outbox_events where lease_token is not null',
      )
    )[0]!;
    expect(lease.payload.eventId).toBe(lease.id);
    await sql(
      "update outbox_events set lease_until=now()-interval '1 second' where id=?",
      [lease.id],
    );
    await Promise.all([child('publish'), child('publish')]);
    while (await publisher.publishBatch(100)) {}
    expect(await count('outbox_events', "where status='PENDING'")).toBe(0);
    const seen = new Set<string>();
    const eventsUrl = await sqs.queue('wager-events.fifo');
    for (let round = 0; round < 150; round++) {
      const messages =
        (
          await sqs.client.send(
            new ReceiveMessageCommand({
              QueueUrl: eventsUrl,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: 1,
            }),
          )
        ).Messages ?? [];
      if (!messages.length) break;
      for (const message of messages) {
        seen.add(JSON.parse(message.Body!).eventId);
        await sqs.client.send(
          new DeleteMessageCommand({
            QueueUrl: eventsUrl,
            ReceiptHandle: message.ReceiptHandle!,
          }),
        );
      }
    }
    expect(seen.size).toBe(await count('outbox_events'));
  }, 30000);

  it('HTTP validation, lookup, stable ledger pagination, readiness and metrics', async () => {
    const w = await wallet();
    const data = input(w),
      key = randomUUID();
    const first = await post(data, key);
    expect(
      (await post({ ...data, kind: 'OPENING' }, randomUUID())).status,
    ).toBe(400);
    expect(
      (
        await post(
          {
            ...data,
            money: { amount: 10 as unknown as string, currency: 'BRL' },
          },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await post({ ...data, money: money('-1.00') }, randomUUID())).status,
    ).toBe(400);
    expect(
      (
        await post(
          { ...data, money: { amount: '1.00', currency: 'USD' } },
          randomUUID(),
        )
      ).status,
    ).toBe(400);
    const base = `http://127.0.0.1:${ports[0]}`;
    expect(
      (
        await fetch(base + '/wagering/transactions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(data),
        })
      ).status,
    ).toBe(400);
    expect(
      (await fetch(base + '/wagering/transactions/' + first.body.transactionId))
        .status,
    ).toBe(200);
    expect(
      (
        await fetch(
          base +
            '/providers/integration/wagering/transactions/' +
            data.externalTransactionId,
        )
      ).status,
    ).toBe(200);
    const page = (await (
      await fetch(base + `/wallets/${w.id}/ledger?limit=1`)
    ).json()) as { items: unknown[]; nextCursor: string };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeString();
    const next = await query.ledger(w.id, page.nextCursor, '1');
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect((await fetch(base + `/wallets/${w.id}/ledger?limit=0`)).status).toBe(
      400,
    );
    expect(
      (await fetch(base + `/wallets/${w.id}/ledger?cursor=garbage`)).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + `/wallets/${w.id}/reconciliation`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
    const malformed = await fetch(base + '/wagering/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    const metadataOnly = { ...input(w), createdAt: 'transport-metadata' };
    expect((await post(metadataOnly, randomUUID())).status).toBe(200);
    expect((await fetch(base + '/health/ready')).status).toBe(200);
    expect(await (await fetch(base + '/metrics')).text()).toContain(
      'transactions_total',
    );
    expect((await fetch(base + '/wallets/missing')).status).toBe(404);
  });

  it('readiness detects unavailable SQS while liveness stays healthy', async () => {
    const previous = env.SQS_ENDPOINT;
    processes[2]!.kill('SIGTERM');
    await processes[2]!.exited;
    env.SQS_ENDPOINT = 'http://127.0.0.1:1';
    spawnApi(2);
    if (previous === undefined) delete env.SQS_ENDPOINT;
    else env.SQS_ENDPOINT = previous;
    try {
      await waitApi(2);
      expect(
        (await fetch(`http://127.0.0.1:${ports[2]}/health/ready`)).status,
      ).toBe(503);
      expect(
        (await fetch(`http://127.0.0.1:${ports[2]}/health/live`)).status,
      ).toBe(200);
    } finally {
      processes[2]!.kill('SIGTERM');
      await processes[2]!.exited;
      spawnApi(2);
      await waitApi(2);
    }
  }, 15000);

  it('restart retains idempotency and reconciled balance', async () => {
    const w = await wallet(),
      data = input(w),
      key = randomUUID();
    const result = await post(data, key);
    const bet = input(w, 'BET', '20.00'),
      refund = input(w, 'REFUND', '20.00', bet.externalTransactionId);
    const pending = await uc.execute(refund, randomUUID());
    await uc.execute(bet, randomUUID());
    processes[0]!.kill('SIGTERM');
    await processes[0]!.exited;
    spawnApi(0, true);
    await waitApi(0);
    for (
      let i = 0;
      i < 60 &&
      (await query.transaction(pending.transactionId)).status !== 'PROCESSED';
      i++
    )
      await Bun.sleep(100);
    expect((await query.transaction(pending.transactionId)).status).toBe(
      'PROCESSED',
    );
    const replay = await post(data, key);
    expect(replay.body.transactionId).toBe(result.body.transactionId);
    expect(replay.body.idempotentReplay).toBe(true);
    expect((await query.reconcile(w.id)).consistent).toBe(true);
  }, 10000);
});
