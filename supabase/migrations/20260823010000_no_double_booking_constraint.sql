-- ============================================================
-- Phase 1, Schritt 3 — harter Überbuchungsschutz auf DB-Ebene.
--
-- Eine reine Prüfung im Anwendungscode ist bei nebenläufigen Buchungen
-- nicht dicht (zwei gleichzeitige Anfragen sehen beide "frei"). Postgres
-- kann das über eine EXCLUDE-Constraint hart garantieren — unabhängig
-- davon, wie viele Prozesse/Requests gleichzeitig schreiben.
--
-- `'[)'` (halboffenes Intervall) ist die Hotel-Semantik: der Abreisetag
-- ist für den nächsten Gast wieder frei (siehe listReservationsInRange()-
-- Kommentar, gleiche Überschneidungslogik).
--
-- Constraint gilt NUR für Reservierungen mit zugewiesenem Zimmer
-- (room_id is not null) und nur für Status, die ein Zimmer tatsächlich
-- belegen (confirmed/checked_in) — stornierte/abgereiste/no-show-
-- Buchungen und (noch) nicht zugewiesene Buchungen (room_id null, z. B.
-- künftige OTA-Kategoriebuchungen) blockieren nichts.
--
-- Vor dem Anlegen wird geprüft, ob Bestandsdaten den Constraint schon
-- verletzen würden (siehe scripts/verify-phase1/03-overbooking-
-- protection.ts für die Positiv-/Negativ-/Nebenläufigkeits-Tests) — zum
-- Zeitpunkt dieser Migration: 0 echte Überlappungen im Bestand.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

create extension if not exists btree_gist;

do $$
declare
  violation_count integer;
begin
  select count(*) into violation_count
  from reservations a
  join reservations b on a.room_id = b.room_id and a.id < b.id
  where a.deleted_at is null and b.deleted_at is null
    and a.room_id is not null
    and a.status in ('confirmed', 'checked_in')
    and b.status in ('confirmed', 'checked_in')
    and daterange(a.check_in_date, a.check_out_date, '[)') && daterange(b.check_in_date, b.check_out_date, '[)');

  if violation_count > 0 then
    raise exception 'Migration abgebrochen: % bestehende Überlappung(en) gefunden — erst manuell bereinigen, bevor der Constraint hinzugefügt wird.', violation_count;
  end if;
end $$;

alter table reservations drop constraint if exists no_double_booking;

alter table reservations add constraint no_double_booking
  exclude using gist (
    room_id with =,
    daterange(check_in_date, check_out_date, '[)') with &&
  ) where (room_id is not null and deleted_at is null
           and status in ('confirmed', 'checked_in'));
