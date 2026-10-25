import { Migration } from '@mikro-orm/migrations';
export class Migration20261025050000 extends Migration {
  override up(): void {
    this
      .addSql(`create or replace function verify_financial_consistency() returns trigger language plpgsql as $$
      declare wid varchar(36); actual numeric; stored numeric;
      begin
        wid := case when TG_TABLE_NAME='wallets' then to_jsonb(NEW)->>'id' else to_jsonb(NEW)->>'wallet_id' end;
        select balance_amount into stored from wallets where id=wid;
        select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0)
          into actual from wallet_ledger_entries where wallet_id=wid;
        if stored is distinct from actual then raise exception 'Wallet and ledger diverge' using errcode='23514'; end if;
        if exists(select 1 from wallet_ledger_entries l join wager_transactions t on t.id=l.transaction_id
          where l.wallet_id=wid and (t.wallet_id<>l.wallet_id or t.currency<>l.currency or t.amount<>l.amount
            or t.status<>'PROCESSED' or t.kind='LOSS'
            or (t.kind in ('OPENING','WIN','REFUND') and l.direction<>'CREDIT')
            or (t.kind='BET' and l.direction<>'DEBIT')
            or (t.kind='ROLLBACK' and l.direction=(select direction from wallet_ledger_entries where transaction_id=t.reference_transaction_id))))
        then raise exception 'Ledger does not match transaction' using errcode='23514'; end if;
        if exists(select 1 from wager_transactions t where t.wallet_id=wid and t.status='PROCESSED' and t.kind<>'LOSS'
          and not exists(select 1 from wallet_ledger_entries l where l.transaction_id=t.id and l.wallet_id=wid))
        then raise exception 'Missing financial ledger entry' using errcode='23514'; end if;
        return null;
      end; $$;
`);
  }
  override down(): void {
    this
      .addSql(`create or replace function verify_financial_consistency() returns trigger language plpgsql as $$
      declare wid varchar(36); actual numeric; stored numeric;
      begin
        wid := case when TG_TABLE_NAME='wallets' then NEW.id else NEW.wallet_id end;
        select balance_amount into stored from wallets where id=wid;
        select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0)
          into actual from wallet_ledger_entries where wallet_id=wid;
        if stored is distinct from actual then raise exception 'Wallet and ledger diverge' using errcode='23514'; end if;
        if exists(select 1 from wallet_ledger_entries l join wager_transactions t on t.id=l.transaction_id
          where l.wallet_id=wid and (t.wallet_id<>l.wallet_id or t.currency<>l.currency or t.amount<>l.amount
            or t.status<>'PROCESSED' or t.kind='LOSS'
            or (t.kind in ('OPENING','WIN','REFUND') and l.direction<>'CREDIT')
            or (t.kind='BET' and l.direction<>'DEBIT')
            or (t.kind='ROLLBACK' and l.direction=(select direction from wallet_ledger_entries where transaction_id=t.reference_transaction_id))))
        then raise exception 'Ledger does not match transaction' using errcode='23514'; end if;
        if exists(select 1 from wager_transactions t where t.wallet_id=wid and t.status='PROCESSED' and t.kind<>'LOSS'
          and not exists(select 1 from wallet_ledger_entries l where l.transaction_id=t.id and l.wallet_id=wid))
        then raise exception 'Missing financial ledger entry' using errcode='23514'; end if;
        return null;
      end; $$;
`);
  }
}
