-- ============================================================
-- Kategorien-Verwaltung (Screen 8-Ergänzung, 23.08.2026): eigenes
-- Beschreibungsfeld für room_types, gebraucht von der neuen
-- Kategorien-Verwaltungsseite (Name, Basispreis/Nacht, max. Personen,
-- Beschreibung). Nullable, kein Backfill nötig.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

alter table room_types add column if not exists description text;
