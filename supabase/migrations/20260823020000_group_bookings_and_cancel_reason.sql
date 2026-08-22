-- ============================================================
-- Phase 1, Schritt 3 — Gruppenbuchungen + Storno-Grund.
--
-- `reservations.group_booking_id` existierte schon (Phase 0), aber als
-- nackte uuid ohne FK/Tabelle/Index — beliebige (auch hotelfremde) Werte
-- wurden bisher akzeptiert. Diese Migration ergänzt die fehlende Tabelle,
-- den echten FK und einen Index (siehe Plan-Abschnitt "Ausgangslage").
--
-- `cancel_reason`: cancelReservation() braucht einen Grund (Design-Regel
-- §6.5 "jede zerstörerische Aktion braucht eine Bestätigung" — der Grund
-- gehört zur Nachvollziehbarkeit dazu, nicht nur die Bestätigung selbst).
--
-- Vor dem FK geprüft: 0 bestehende reservations.group_booking_id-Werte
-- im Bestand (Gruppenbuchungs-Flow existierte bisher nicht) — kein
-- Daten-Cleanup nötig.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

create table if not exists group_bookings (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references hotels(id) on delete cascade,
  name              text not null,
  contact_guest_id  uuid references guests(id),
  check_in_date     date,
  check_out_date    date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists idx_group_bookings_hotel on group_bookings(hotel_id) where deleted_at is null;

alter table reservations drop constraint if exists reservations_group_booking_id_fkey;
alter table reservations add constraint reservations_group_booking_id_fkey
  foreign key (group_booking_id) references group_bookings(id);
create index if not exists idx_reservations_group_booking on reservations(group_booking_id) where group_booking_id is not null;

alter table reservations add column if not exists cancel_reason text;
