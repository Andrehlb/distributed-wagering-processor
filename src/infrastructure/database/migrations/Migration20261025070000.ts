import { Migration } from '@mikro-orm/migrations';
/** PostgreSQL numeric accepts NaN; positivity checks alone do not exclude it. */
export class Migration20261025070000 extends Migration {
  override up():void {
    this.addSql(`alter table wallets add constraint chk_wallet_finite check(balance_amount <> 'NaN'::numeric);
      alter table wager_transactions add constraint chk_wager_finite check(amount <> 'NaN'::numeric and (balance_snapshot is null or balance_snapshot <> 'NaN'::numeric));
      alter table wallet_ledger_entries add constraint chk_ledger_finite check(amount <> 'NaN'::numeric and balance_before <> 'NaN'::numeric and balance_after <> 'NaN'::numeric);`);
  }
  override down():void {
    this.addSql(`alter table wallet_ledger_entries drop constraint chk_ledger_finite;
      alter table wager_transactions drop constraint chk_wager_finite;
      alter table wallets drop constraint chk_wallet_finite;`);
  }
}
