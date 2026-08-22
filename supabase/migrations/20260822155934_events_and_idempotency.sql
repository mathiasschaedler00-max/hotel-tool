-- ============================================================
-- Stage 6: events (Append-Only Sync-Log / Event-Bus-Payload-Historie)
-- + idempotency_keys (K6-Vorbereitung für Offline-/Retry-Sicherheit).
-- Fully idempotent.
-- ============================================================

-- `events` ist bewusst NICHT dasselbe wie die pg-boss-eigenen Tabellen im
-- `pgboss`-Schema (die verwaltet pg-boss selbst und legt sie bei `boss.start()`
-- an). Diese Tabelle hier ist unser eigener, fachlicher, monoton wachsender
-- Log — künftige Mobile-Clients fragen "alles seit Cursor X" ab (K6). Sie wird
-- von `modules/_shared/write.ts#executeWrite()` parallel zum pg-boss-Publish
-- befüllt (gleiche Transaktion).
create table if not exists events (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  event_type      text not null,
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  payload         jsonb not null,
  created_by      uuid references auth.users(id), -- nullable: System-Jobs haben keinen anfragenden User
  created_at      timestamptz not null default now()
);
create index if not exists idx_events_hotel on events(hotel_id) where true;
create index if not exists idx_events_hotel_created on events(hotel_id, created_at);

alter table events enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'events' and policyname = 'hotel members read events'
  ) then
    create policy "hotel members read events" on events for select using (is_hotel_member(hotel_id));
  end if;
end $$;

-- `idempotency_keys`: pro Hotel + Client-Key + Endpunkt wird die Response
-- einmal zwischengespeichert. TODO: Prüfung/Speicherung ist in der API-Schicht
-- noch nicht verdrahtet (siehe modules/_shared/context.ts — `idempotencyKey`
-- wird nur aus dem Header gelesen, aber noch nicht gegen diese Tabelle
-- geprüft). Tabelle existiert bereits, damit Stage 10 (Offline/Sync-Review)
-- ohne Schema-Änderung darauf aufsetzen kann.
create table if not exists idempotency_keys (
  hotel_id            uuid not null references hotels(id) on delete cascade,
  key                 text not null,
  endpoint            text not null,
  response_snapshot   jsonb,
  created_at          timestamptz not null default now(),
  primary key (hotel_id, key, endpoint)
);

alter table idempotency_keys enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'idempotency_keys' and policyname = 'hotel members read idempotency keys'
  ) then
    create policy "hotel members read idempotency keys" on idempotency_keys for select using (is_hotel_member(hotel_id));
  end if;
end $$;
