-- ============================================================
-- Stage 5: Fachdomäne PMS (room_types, rooms, guests, reservations,
-- folios, folio_postings, payments)
-- Annahmen markiert, wo Teil A fehlt. Fully idempotent.
-- ============================================================

-- ── room_types ───────────────────────────────────────────────
-- Zweistufiges Zimmer-Modell (Branchenstandard) — Annahme, Teil A prüfen.
create table if not exists room_types (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references hotels(id) on delete cascade,
  name                text not null,
  code                text,
  capacity_adults     integer not null default 2,
  capacity_children   integer not null default 0,
  base_rate_cents     integer not null default 0, -- TODO: Geschäftsregeln aus Teil A ergänzen (Saison-/Ratenlogik)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index if not exists idx_room_types_hotel on room_types(hotel_id) where deleted_at is null;

-- ── rooms ────────────────────────────────────────────────────
create table if not exists rooms (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id),
  room_number   text not null,
  floor         text,
  -- Annahme — Teil A prüfen: einfacher Betriebsstatus. Reinigungsstatus im
  -- engeren Sinn lebt in modules/housekeeping (tasks), nicht hier.
  status        text not null default 'available' check (status in
    ('available','occupied','out_of_order')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists idx_rooms_hotel on rooms(hotel_id) where deleted_at is null;
create unique index if not exists idx_rooms_hotel_number on rooms(hotel_id, room_number) where deleted_at is null;

-- ── guests ───────────────────────────────────────────────────
create table if not exists guests (
  id                          uuid primary key default gen_random_uuid(),
  hotel_id                    uuid not null references hotels(id) on delete cascade,
  first_name                  text not null,
  last_name                   text not null,
  email                       text,
  phone                       text,
  nationality                 text,
  -- Feldebene Verschlüsselung für Ausweis-/Passnummer vor dem Insert (siehe
  -- ARCHITECTURE.md Sicherheitsbasis). WELCHE Felder genau: Annahme — Teil A
  -- prüfen. Verschlüsselung/Entschlüsselung passiert in
  -- modules/pms/guests/service.ts, NICHT in der DB (keine pgcrypto-Spalten-
  -- funktionen hier, damit der Schlüssel nie in der DB selbst liegt).
  document_number_encrypted   bytea,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);
create index if not exists idx_guests_hotel on guests(hotel_id) where deleted_at is null;

-- ── reservations ─────────────────────────────────────────────
-- 1 Reservation = 1 Room-Stay; group_booking_id für Gruppenbuchungen
-- (Annahme — Teil A prüfen). reservation_no ist menschenlesbar und getrennt
-- von der UUID (K6: Offline-Client kann lokal mit UUID anlegen, reservation_no
-- kommt erst bei Sync).
create table if not exists reservations (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references hotels(id) on delete cascade,
  reservation_no      text not null,
  group_booking_id    uuid,
  guest_id            uuid not null references guests(id),
  room_type_id        uuid not null references room_types(id),
  room_id             uuid references rooms(id),
  check_in_date       date not null,
  check_out_date      date not null,
  status              text not null default 'confirmed' check (status in
    ('confirmed','checked_in','checked_out','cancelled','no_show')),
  source              text not null default 'direct' check (source in
    ('direct','channel_manager','phone','walk_in')),
  adults              integer not null default 1,
  children            integer not null default 0,
  rate_cents          integer not null default 0, -- TODO: Geschäftsregeln aus Teil A ergänzen (Preisfindung, Storno-Regeln)
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  constraint chk_reservations_dates check (check_out_date > check_in_date)
);
create index if not exists idx_reservations_hotel on reservations(hotel_id) where deleted_at is null;
create unique index if not exists idx_reservations_hotel_no on reservations(hotel_id, reservation_no) where deleted_at is null;
create index if not exists idx_reservations_room on reservations(room_id) where deleted_at is null;

-- ── folios ───────────────────────────────────────────────────
-- `prev_signature_hash`/`signature_hash`: Platzhalter für spätere
-- RKSV-Signaturkette, NICHT Phase 0 (siehe ARCHITECTURE.md).
create table if not exists folios (
  id                    uuid primary key default gen_random_uuid(),
  hotel_id              uuid not null references hotels(id) on delete cascade,
  reservation_id        uuid not null references reservations(id),
  guest_id              uuid not null references guests(id),
  status                text not null default 'open' check (status in ('open','closed')),
  prev_signature_hash   text,
  signature_hash        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  closed_at             timestamptz,
  deleted_at            timestamptz
);
create index if not exists idx_folios_hotel on folios(hotel_id) where deleted_at is null;
create index if not exists idx_folios_reservation on folios(reservation_id) where deleted_at is null;

-- ── folio_postings ───────────────────────────────────────────
create table if not exists folio_postings (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  folio_id       uuid not null references folios(id) on delete cascade,
  posting_type   text not null check (posting_type in ('charge','payment','adjustment')), -- TODO: Geschäftsregeln aus Teil A ergänzen (Fiskal-/Steuerlogik)
  description    text not null,
  amount_cents   integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists idx_folio_postings_hotel on folio_postings(hotel_id) where deleted_at is null;
create index if not exists idx_folio_postings_folio on folio_postings(folio_id) where deleted_at is null;

-- ── payments ─────────────────────────────────────────────────
create table if not exists payments (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references hotels(id) on delete cascade,
  folio_id         uuid references folios(id),
  reservation_id   uuid references reservations(id),
  amount_cents     integer not null,
  method           text not null check (method in ('cash','card','bank_transfer','online')),
  status           text not null default 'completed' check (status in ('pending','completed','refunded','failed')), -- Annahme — Teil A prüfen
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists idx_payments_hotel on payments(hotel_id) where deleted_at is null;

-- ── updated_at-Trigger (K6-Vorbereitung, set_updated_at() aus Stage-1-Migration) ──
do $$
declare
  t text;
begin
  foreach t in array array['room_types','rooms','guests','reservations','folios','folio_postings','payments']
  loop
    execute format(
      'create or replace trigger set_updated_at before update on %I for each row execute function set_updated_at()',
      t
    );
  end loop;
end $$;

-- ── RLS: Policy-Muster einheitlich für jede fachliche Tabelle ───────────────
do $$
declare
  t text;
begin
  foreach t in array array['room_types','rooms','guests','reservations','folios','folio_postings','payments']
  loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = 'hotel members read/write'
    ) then
      execute format(
        'create policy "hotel members read/write" on %I for all using (is_hotel_member(hotel_id))',
        t
      );
    end if;
  end loop;
end $$;
