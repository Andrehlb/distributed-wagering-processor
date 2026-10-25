import { Migration } from '@mikro-orm/migrations';
export class Migration20261025040000 extends Migration {
  override up(): void {
    this
      .addSql(`alter table wallet_ledger_entries add column sequence bigint generated always as identity;
      create unique index uq_ledger_sequence on wallet_ledger_entries(sequence);
      create index idx_ledger_wallet_sequence on wallet_ledger_entries(wallet_id,sequence);
      create trigger trg_wallet_ledger_no_truncate before truncate on wallet_ledger_entries
      for each statement execute function prevent_wallet_ledger_mutation();`);
  }
  override down(): void {
    this
      .addSql(`drop trigger trg_wallet_ledger_no_truncate on wallet_ledger_entries;
      drop index idx_ledger_wallet_sequence; drop index uq_ledger_sequence;
      alter table wallet_ledger_entries drop column sequence;`);
  }
}
