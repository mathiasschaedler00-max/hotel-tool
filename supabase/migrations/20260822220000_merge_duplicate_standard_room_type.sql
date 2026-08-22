-- ============================================================
-- Aufräumen (Review-Fund, 22.08.2026): "Doppelzimmer Standard" und
-- "Standard" sind zwei separate room_types-Zeilen, die zu verschiedenen
-- Zeitpunkten entstanden sind (Schritt 1: Zimmer 101/102 manuell über die
-- API angelegt; Schritt 2: Demo-Seed hat "Standard/Komfort/Suite" neu
-- erzeugt, ohne die ältere Kategorie zu kennen) — kein Datenfehler, aber
-- verwirrend als zwei separate Kategorien im Kategorie-Filter sichtbar.
--
-- Konsolidierung PRO HOTEL (wichtig — die erste Fassung dieser Migration
-- hat versehentlich hotelübergreifend gematcht, siehe Korrektur-Migration
-- 20260822220100, die den daraus entstandenen Schaden repariert): rooms +
-- reservations, die auf "Doppelzimmer Standard" zeigen, auf "Standard"
-- DESSELBEN Hotels umhängen, dann die jetzt leere Kategorie weich löschen.
-- Fully idempotent — safe to run multiple times.
-- ============================================================

do $$
declare
  hotel record;
  old_type_id uuid;
  new_type_id uuid;
begin
  for hotel in select id from hotels where deleted_at is null loop
    select id into old_type_id from room_types
      where hotel_id = hotel.id and name = 'Doppelzimmer Standard' and deleted_at is null limit 1;
    select id into new_type_id from room_types
      where hotel_id = hotel.id and name = 'Standard' and deleted_at is null limit 1;

    if old_type_id is not null and new_type_id is not null and old_type_id <> new_type_id then
      update rooms set room_type_id = new_type_id where room_type_id = old_type_id and hotel_id = hotel.id;
      update reservations set room_type_id = new_type_id where room_type_id = old_type_id and hotel_id = hotel.id;
      update room_types set deleted_at = now() where id = old_type_id;
    end if;
  end loop;
end $$;
