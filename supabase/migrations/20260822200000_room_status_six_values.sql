-- ============================================================
-- Phase 1, Schritt 1: rooms.status auf sechs Werte erweitern.
--
-- Bisher (Phase 0, Annahme): available | occupied | out_of_order
-- Jetzt (bestätigt gegen docs/design/hotel-tool-design-referenz.md §3,
-- deckungsgleich mit dem Belegungsplan-Prototyp): frei · reserviert ·
-- belegt · Reinigung · Wartung · gesperrt.
--
-- Mapping der bisherigen Werte (keine bestehenden `out_of_order`-Zeilen
-- zum Zeitpunkt dieser Migration, siehe Prüfung vor dem Schreiben —
-- Mapping trotzdem idempotent für spätere Umgebungen mit Altdaten):
--   available    → available   (unverändert)
--   occupied     → occupied    (unverändert)
--   out_of_order → maintenance (nächstliegende Bedeutung von "außer Betrieb")
--
-- Neu hinzugekommen: reserved, cleaning, blocked.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

update rooms set status = 'maintenance' where status = 'out_of_order';

alter table rooms drop constraint if exists rooms_status_check;

alter table rooms add constraint rooms_status_check check (status in
  ('available', 'reserved', 'occupied', 'cleaning', 'maintenance', 'blocked'));
