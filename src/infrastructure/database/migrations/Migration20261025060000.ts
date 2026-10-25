import { Migration } from '@mikro-orm/migrations';
/** Bind every accepted transport key, including external-ID replays with a new key. */
export class Migration20261025060000 extends Migration {
  override up():void {
    this.addSql(`create table wager_idempotency_keys (
      idempotency_key varchar(150) primary key,
      transaction_id varchar(36) not null references wager_transactions(id) on delete restrict);
      insert into wager_idempotency_keys select idempotency_key,id from wager_transactions;
      create function protect_idempotency_key() returns trigger language plpgsql as $$
      begin raise exception 'Idempotency bindings are immutable'; end; $$;
      create trigger trg_idempotency_immutable before update or delete on wager_idempotency_keys
        for each row execute function protect_idempotency_key();`);
  }
  override down():void {
    this.addSql(`drop trigger trg_idempotency_immutable on wager_idempotency_keys;
      drop function protect_idempotency_key();drop table wager_idempotency_keys;`);
  }
}
