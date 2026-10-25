
import { Migration } from '@mikro-orm/migrations';

export class Migration20261025002426 extends Migration {
  override name = 'Migration20261025002426';

  override up(): void {
    this.addSql(`
      create table "wallet_ledger_entries" (
        "id" varchar(36) not null,
        "wallet_id" varchar(36) not null,
        "transaction_id" varchar(36) not null,
        "direction" varchar(10) not null,
        "amount" numeric(30,2) not null,
        "currency" varchar(3) not null,
        "balance_before" numeric(30,2) not null,
        "balance_after" numeric(30,2) not null,
        "created_at" timestamptz not null,

        constraint "pk_wallet_ledger_entries"
          primary key ("id"),

        constraint "uq_ledger_wallet_transaction"
          unique ("wallet_id", "transaction_id"),

        constraint "chk_ledger_amount_positive"
          check ("amount" > 0),

        constraint "chk_ledger_direction"
          check ("direction" in ('DEBIT', 'CREDIT')),

        constraint "chk_ledger_balances_non_negative"
          check (
            "balance_before" >= 0
            and "balance_after" >= 0
          ),

        constraint "chk_ledger_arithmetic"
          check (
            (
              "direction" = 'CREDIT'
              and "balance_after" = "balance_before" + "amount"
            )
            or
            (
              "direction" = 'DEBIT'
              and "balance_after" = "balance_before" - "amount"
            )
          ),

        constraint "fk_ledger_wallet"
          foreign key ("wallet_id")
          references "wallets" ("id")
          on delete restrict,

        constraint "fk_ledger_transaction"
          foreign key ("transaction_id")
          references "wager_transactions" ("id")
          on delete restrict
      );
    `);

    this.addSql(`
      create index "idx_ledger_wallet_created"
      on "wallet_ledger_entries" ("wallet_id", "created_at", "id");
    `);

    this.addSql(`
      create or replace function prevent_wallet_ledger_mutation()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception
          'Wallet ledger entries are immutable'
          using errcode = 'P0001';
      end;
      $$;
    `);

    this.addSql(`
      create trigger "trg_wallet_ledger_immutable"
      before update or delete
      on "wallet_ledger_entries"
      for each row
      execute function prevent_wallet_ledger_mutation();
    `);
  }

  override down(): void {
    this.addSql(`
      drop trigger "trg_wallet_ledger_immutable"
      on "wallet_ledger_entries";
    `);

    this.addSql(`
      drop function prevent_wallet_ledger_mutation();
    `);

    this.addSql(`
      drop table "wallet_ledger_entries";
    `);
  }
}
