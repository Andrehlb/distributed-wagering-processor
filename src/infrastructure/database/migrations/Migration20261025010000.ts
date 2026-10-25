
import { Migration } from '@mikro-orm/migrations';

export class Migration20261025010000 extends Migration {
  override name = 'Migration20261025010000';

  override up(): void {
    this.addSql(`
      create table "outbox_events" (
        "id" varchar(36) primary key,
        "event_type" varchar(100) not null,
        "aggregate_id" varchar(36) not null,
        "payload" jsonb not null,
        "status" varchar(20) not null default 'PENDING',
        "attempts" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "published_at" timestamptz null,

        constraint "chk_outbox_status"
          check ("status" in ('PENDING', 'PUBLISHED')),

        constraint "chk_outbox_attempts"
          check ("attempts" >= 0)
      );
    `);

    this.addSql(`
      create index "idx_outbox_pending"
      on "outbox_events" ("created_at", "id")
      where "status" = 'PENDING';
    `);
  }

  override down(): void {
    this.addSql('drop table "outbox_events";');
  }
}
