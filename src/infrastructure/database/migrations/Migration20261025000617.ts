import { Migration } from '@mikro-orm/migrations';

export class Migration20261025000617 extends Migration {
  override name = 'Migration20261025000617';

  override up(): void | Promise<void> {
    this.addSql(
      `create table "wager_transactions" ("id" varchar(36) not null, "provider_id" varchar(100) not null, "external_transaction_id" varchar(150) not null, "idempotency_key" varchar(150) not null, "payload_hash" varchar(128) not null, "wallet_id" varchar(36) not null, "player_id" varchar(36) not null, "round_id" varchar(150) not null, "game_id" varchar(150) not null, "kind" varchar(20) not null, "status" varchar(30) not null, "amount" numeric(30,2) not null, "currency" varchar(3) not null, "reference_external_transaction_id" varchar(150) null, "reference_transaction_id" varchar(36) null, "failure_code" varchar(100) null, "created_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "uq_wager_provider_external" unique ("provider_id", "external_transaction_id");`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "uq_wager_idempotency_key" unique ("idempotency_key");`,
    );

    this.addSql(
      `alter table "wager_transactions" add constraint "chk_wager_amount_positive" check ("amount" > 0);`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "chk_wager_kind" check ("kind" IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`,
    );
    this.addSql(
      `alter table "wager_transactions" add constraint "chk_wager_status" check ("status" IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`,
    );

    this.addSql(`
  alter table "wager_transactions"
  add constraint "fk_wager_wallet"
  foreign key ("wallet_id")
  references "wallets" ("id")
  on delete restrict;
`);

    this.addSql(`
  alter table "wager_transactions"
  add constraint "fk_wager_reference"
  foreign key ("reference_transaction_id")
  references "wager_transactions" ("id")
  on delete restrict;
`);

    this.addSql(`
  create index "idx_wager_wallet_created"
  on "wager_transactions" ("wallet_id", "created_at");
`);

    this.addSql(`
  create index "idx_wager_pending_reference"
  on "wager_transactions" ("status", "created_at")
  where "status" = 'PENDING_REFERENCE';
`);
  }

  override down(): void {
    this.addSql('drop table "wager_transactions";');
  }
}
