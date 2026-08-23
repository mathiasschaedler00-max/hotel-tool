-- Auftrag 23.08.2026 (Abnahmetest): Kategorien konnten mit doppeltem Namen
-- angelegt werden — exakt das Problem, das die Migration
-- 20260822220000_merge_duplicate_standard_room_type.sql schon einmal
-- nachträglich aufräumen musste. Jetzt an der Wurzel verhindert.
create unique index if not exists idx_room_types_hotel_name
  on room_types (hotel_id, lower(name))
  where deleted_at is null;
