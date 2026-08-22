-- ============================================================
-- Phase 1, Schritt 2 (Korrektur nach Review): rooms.status auf die vier
-- echten Zimmer-/Housekeeping-Zustände reduzieren.
--
-- Bisher (seit 20260822200000): available | reserved | occupied |
-- cleaning | maintenance | blocked (6 Werte).
--
-- Problem: "reserved"/"occupied" sind kein Zimmer-Zustand, sondern ein
-- ABGELEITETER Buchungsstatus (reservations.status). Als frei editierbarer
-- Dropdown-Wert am Zimmer selbst konnten beide unabhängig von der
-- tatsächlichen Reservierungslage gesetzt werden — genau das ist beim
-- Phase-1-Review passiert (Zimmer 101 stand versehentlich auf "reserviert",
-- obwohl keine aktuelle Buchung das rechtfertigte). Belegt/Reserviert werden
-- ab jetzt ausschließlich aus reservations.status abgeleitet und im
-- Belegungsplan über die Buchungsbalken dargestellt (siehe
-- reservation-status.ts) — rooms.status bildet nur noch den
-- Housekeeping-/Betriebszustand ab: frei · Reinigung · Wartung · gesperrt.
--
-- Datenmigration: bestehende reserved/occupied-Zeilen auf 'available'
-- zurücksetzen (zum Zeitpunkt dieser Migration keine vorhanden, siehe
-- Prüfung vor dem Schreiben — trotzdem idempotent für spätere Umgebungen).
-- Fully idempotent — safe to run multiple times.
-- ============================================================

update rooms set status = 'available' where status in ('reserved', 'occupied');

alter table rooms drop constraint if exists rooms_status_check;

alter table rooms add constraint rooms_status_check check (status in
  ('available', 'cleaning', 'maintenance', 'blocked'));
