-- ============================================================
-- Repariert einen Schaden, den die ERSTE (fehlerhafte, nicht hotel-
-- gescopte) Fassung von 20260822220000 auf der echten DB angerichtet hat:
-- sie hat ein Zimmer + eine Reservierung von "Testhotel A (mt4nhj4n)"
-- (Rest eines früheren Abnahmetests) versehentlich auf die room_type_id
-- des DEMO-HOTELS umgehängt — ein Cross-Tenant-Fremdschlüssel, der nie
-- entstehen dürfte. Migrationen laufen mit Service-Rechten und umgehen
-- damit genau die Prüfungen (assertBelongsToHotel), die das im
-- Anwendungscode verhindern.
--
-- 1. Betroffenes Zimmer/Reservierung zurück auf die EIGENE (Testhotel-A-)
--    "Doppelzimmer Standard"-Zeile hängen, die die fehlerhafte Migration
--    fälschlich weich gelöscht hatte — dafür erst wiederherstellen.
-- 2. Danach die eigentlich beabsichtigte Konsolidierung für das Demo-Hotel
--    nachholen (dort war noch nichts passiert, siehe alte Migration).
-- Fully idempotent — safe to run multiple times.
-- ============================================================

do $$
declare
  testhotel_a_id uuid := '5103a0ee-96ee-4cae-b08d-cc35dc0f25f0';
  wrong_type_id uuid := 'ef664e10-7d43-424d-89c0-cb2c60d77ac0'; -- Demo-Hotel "Standard"
  own_type_id uuid := '06df114d-5750-46bb-b4f5-9388a98e281b';   -- Testhotel A eigene "Doppelzimmer Standard"
begin
  -- Schritt 1: eigene Kategorie wiederherstellen und Referenzen zurückhängen.
  update room_types set deleted_at = null where id = own_type_id;
  update rooms set room_type_id = own_type_id
    where hotel_id = testhotel_a_id and room_type_id = wrong_type_id;
  update reservations set room_type_id = own_type_id
    where hotel_id = testhotel_a_id and room_type_id = wrong_type_id;
end $$;

-- Schritt 2: die eigentlich beabsichtigte Demo-Hotel-Konsolidierung
-- nachholen (identische Logik wie 20260822220000, jetzt korrekt gescoped).
do $$
declare
  demo_hotel_id uuid := '7c614a80-2b32-4dc1-9891-55ae195af974';
  old_type_id uuid;
  new_type_id uuid;
begin
  select id into old_type_id from room_types
    where hotel_id = demo_hotel_id and name = 'Doppelzimmer Standard' and deleted_at is null limit 1;
  select id into new_type_id from room_types
    where hotel_id = demo_hotel_id and name = 'Standard' and deleted_at is null limit 1;

  if old_type_id is not null and new_type_id is not null and old_type_id <> new_type_id then
    update rooms set room_type_id = new_type_id where room_type_id = old_type_id and hotel_id = demo_hotel_id;
    update reservations set room_type_id = new_type_id where room_type_id = old_type_id and hotel_id = demo_hotel_id;
    update room_types set deleted_at = now() where id = old_type_id;
  end if;
end $$;
