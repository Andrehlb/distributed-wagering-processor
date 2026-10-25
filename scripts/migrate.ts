import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/infrastructure/database/mikro-orm.config.js';
const orm = await MikroORM.init(config);
try {
  if (process.argv[2] === 'down') await orm.migrator.down();
  else await orm.migrator.up();
} finally {
  await orm.close();
}
