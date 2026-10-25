
import { Migration } from '@mikro-orm/migrations';

export class Migration20261025020000 extends Migration {
  override name = 'Migration20261025020000';

  override up(): void {
    this.addSql(`
      alter table "wager_transactions"
      add column "balance_snapshot" numeric(30,2) null;
    `);
  }

  override down(): void {
    this.addSql(`
      alter table "wager_transactions"
      drop column "balance_snapshot";
    `);
  }
}
