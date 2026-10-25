import { Migration } from '@mikro-orm/migrations';

export class Migration20261025030000 extends Migration {
  override up(): void {
    this.addSql(`alter table wager_transactions
      add column original_response jsonb null,
      add column reference_attempts integer not null default 0,
      add column next_attempt_at timestamptz null,
      add column correlation_id varchar(150) null;
      alter table outbox_events add column next_attempt_at timestamptz null,
      add column lease_token varchar(36) null, add column lease_until timestamptz null;
      create table inbox_messages (
        consumer_name varchar(100) not null, message_id varchar(150) not null,
        payload_hash varchar(128) not null, received_at timestamptz not null,
        processed_at timestamptz not null, transaction_id varchar(36) not null references wager_transactions(id),
        primary key (consumer_name,message_id));
      create unique index uq_wager_reversal on wager_transactions(reference_transaction_id,kind)
        where status='PROCESSED' and kind in ('REFUND','ROLLBACK');
      create index idx_wager_reference_due on wager_transactions(next_attempt_at,id) where status='PENDING_REFERENCE';
      create index idx_outbox_due on outbox_events(next_attempt_at,lease_until,created_at,id) where status='PENDING';
      alter table wager_transactions add constraint chk_reference_attempts check(reference_attempts>=0);
      alter table wager_transactions add constraint chk_wager_reference_required check
        (kind not in ('REFUND','ROLLBACK') or reference_external_transaction_id is not null);
      alter table wager_transactions add constraint chk_wager_rejection_code check
        (status not in ('REJECTED','FAILED') or failure_code is not null);
      alter table wager_transactions add constraint chk_wager_processed_time check
        (status <> 'PROCESSED' or processed_at is not null);
    `);
    // Recover the snapshots of historical OPENING rows using the immutable ledger.
    this
      .addSql(`update wager_transactions t set balance_snapshot=l.balance_after
      from wallet_ledger_entries l where l.transaction_id=t.id and t.balance_snapshot is null;`);
    this
      .addSql(`create function protect_wager_transaction() returns trigger language plpgsql as $$
      begin
        if TG_OP='DELETE' then raise exception 'Transactions cannot be deleted'; end if;
        if OLD.status in ('PROCESSED','REJECTED','FAILED') then raise exception 'Terminal transaction is immutable'; end if;
        if (to_jsonb(NEW) - array['status','reference_transaction_id','failure_code','processed_at','balance_snapshot','reference_attempts','next_attempt_at'])
          is distinct from (to_jsonb(OLD) - array['status','reference_transaction_id','failure_code','processed_at','balance_snapshot','reference_attempts','next_attempt_at'])
        then raise exception 'Transaction identity and original response are immutable'; end if;
        return NEW;
      end; $$;
      create trigger trg_wager_immutable before update or delete on wager_transactions
      for each row execute function protect_wager_transaction();
      create function protect_wallet_version() returns trigger language plpgsql as $$
      begin
        if NEW.player_id<>OLD.player_id or NEW.currency<>OLD.currency or NEW.id<>OLD.id then raise exception 'Wallet identity is immutable'; end if;
        if NEW.version <> OLD.version + (case when NEW.balance_amount<>OLD.balance_amount then 1 else 0 end)
        then raise exception 'Invalid wallet version'; end if;
        return NEW;
      end; $$;
      create trigger trg_wallet_version before update on wallets for each row execute function protect_wallet_version();`);
    this
      .addSql(`create function verify_financial_consistency() returns trigger language plpgsql as $$
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
      create constraint trigger trg_wallet_consistency after insert or update on wallets deferrable initially deferred
        for each row execute function verify_financial_consistency();
      create constraint trigger trg_ledger_consistency after insert on wallet_ledger_entries deferrable initially deferred
        for each row execute function verify_financial_consistency();
      create constraint trigger trg_wager_consistency after insert or update on wager_transactions deferrable initially deferred
        for each row execute function verify_financial_consistency();`);
  }
  override down(): void {
    this.addSql(`drop trigger trg_wager_consistency on wager_transactions;
      drop trigger trg_ledger_consistency on wallet_ledger_entries;
      drop trigger trg_wallet_consistency on wallets;
      drop function verify_financial_consistency();
      drop trigger trg_wallet_version on wallets; drop function protect_wallet_version();
      drop trigger trg_wager_immutable on wager_transactions; drop function protect_wager_transaction();
      alter table wager_transactions drop constraint chk_reference_attempts, drop constraint chk_wager_reference_required,
        drop constraint chk_wager_rejection_code, drop constraint chk_wager_processed_time;
      drop index idx_outbox_due; drop index idx_wager_reference_due; drop index uq_wager_reversal;
      drop table inbox_messages;
      alter table outbox_events drop column next_attempt_at, drop column lease_token, drop column lease_until;
      alter table wager_transactions drop column original_response, drop column reference_attempts,
        drop column next_attempt_at, drop column correlation_id;`);
  }
}
