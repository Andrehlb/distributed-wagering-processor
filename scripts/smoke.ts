import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/infrastructure/database/mikro-orm.config.js';
import { OpenWalletUseCase } from '../src/application/use-cases/open-wallet.use-case.js';
import { ProcessWagerUseCase } from '../src/application/use-cases/process-wager.use-case.js';
import { QueryWageringUseCase } from '../src/application/use-cases/query-wagering.use-case.js';
const admin = await MikroORM.init(config);
const db = 'wagering_test_' + Date.now();
await admin.em.fork().execute(`create database "${db}"`);
await admin.close();
const orm = await MikroORM.init({ ...config, dbName: db });
try {
  await orm.migrator.up();
  console.log(
    'schema_diff',
    await orm.schema.getUpdateSchemaSQL({ wrap: false }),
  );
  const wallet = await new OpenWalletUseCase(orm.em).execute({
    playerId: crypto.randomUUID(),
    initialBalance: { amount: '100.00', currency: 'BRL' },
  });
  const uc = new ProcessWagerUseCase(orm.em);
  const input = {
    providerId: 'smoke',
    externalTransactionId: crypto.randomUUID(),
    playerId: wallet.playerId,
    walletId: wallet.id,
    roundId: 'r',
    gameId: 'g',
    kind: 'BET',
    money: { amount: '80.00', currency: 'BRL' },
  };
  const key = crypto.randomUUID();
  console.log(await uc.execute(input, key));
  console.log(await uc.execute(input, key));
  console.log(await new QueryWageringUseCase(orm.em).reconcile(wallet.id));
  console.log(await new QueryWageringUseCase(orm.em).ledger(wallet.id));
} finally {
  await orm.close();
}
