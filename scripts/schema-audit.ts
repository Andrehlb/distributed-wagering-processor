import { MikroORM } from '@mikro-orm/postgresql';
import config from '../src/infrastructure/database/mikro-orm.config.js';
const orm = await MikroORM.init(config);
try {
  console.log(await orm.schema.getUpdateSchemaSQL({ wrap: false }));
} finally {
  await orm.close();
}
