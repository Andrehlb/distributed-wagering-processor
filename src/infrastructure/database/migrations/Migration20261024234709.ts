
import { Migration } from '@mikro-orm/migrations';

export class Migration20261024234709 extends Migration {
  override name = 'Migration20261024234709';

  override up(): void {
    this.addSql(`
      create table "wallets" (
        "id" varchar(36) not null,
        "player_id" varchar(36) not null,
        "currency" varchar(3) not null,
        "balance_amount" numeric(30,2) not null,
        "version" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,

        constraint "pk_wallets" primary key ("id"),
        constraint "uq_wallet_player_currency"
          unique ("player_id", "currency"),
        constraint "chk_wallet_balance_non_negative"
          check ("balance_amount" >= 0),
        constraint "chk_wallet_version_positive"
          check ("version" >= 1)
      );
    `);
  }

  override down(): void {
    this.addSql('drop table if exists "wallets";');
  }
}
