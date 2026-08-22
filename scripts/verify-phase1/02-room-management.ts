/**
 * Phase 1, Schritt 1 — Verifikation von Screen 8 (Zimmerverwaltung +
 * Kategorien-Verwaltung), Auftrag 23.08.2026: "prüfe nochmal mit test".
 *
 * Läuft gegen das echte Demo Hotel (kein neues Testhotel-Fixture nötig —
 * die Rooms/Room-Types-Funktionen brauchen kein Zwei-Hotel-Setup, anders
 * als der Cross-Tenant-Test in 01-*). Alle selbst angelegten Datensätze
 * (Kategorie + Zimmer) werden am Ende wieder deaktiviert (Soft-Delete) —
 * keine sichtbaren Test-Reste in der UI.
 *
 * Prüft:
 * 1. createRoomType()/updateRoomType() — DB-Werte + Audit-Log + Events
 * 2. createRoom()/updateRoom()/updateRoomStatus() — dieselbe Kette
 * 3. deactivateRoom() — Soft-Delete, verschwindet aus listRooms()
 * 4. deactivateRoomType() BLOCKIERT, solange noch ein aktives Zimmer
 *    zugeordnet ist (Positiv- UND Negativkontrolle: echte Kategorie
 *    "Standard" mit 9 Zimmern darf nicht deaktivierbar sein; die eigene
 *    Testkategorie erst nach dem Deaktivieren ihres einzigen Zimmers)
 */
import { rawPool, record, assertTrue, findDemoHotelContext } from "./_lib";
import { createRoomType, updateRoomType, deactivateRoomType, listRoomTypes } from "@modules/pms/room-types/service";
import { createRoom, updateRoom, updateRoomStatus, deactivateRoom, listRooms } from "@modules/pms/rooms/service";
import { ConflictError } from "@modules/_shared/errors";

async function countAudit(hotelId: string, resourceType: string, resourceId: string, action: string): Promise<number> {
  const pool = rawPool();
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from audit_log where hotel_id = $1 and resource_type = $2 and resource_id = $3 and action = $4`,
    [hotelId, resourceType, resourceId, action]
  );
  return Number(rows[0].count);
}

async function countEvents(hotelId: string, aggregateId: string, eventType: string): Promise<number> {
  const pool = rawPool();
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from events where hotel_id = $1 and aggregate_id = $2 and event_type = $3`,
    [hotelId, aggregateId, eventType]
  );
  return Number(rows[0].count);
}

export async function testRoomManagement(): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  function check(label: string, ok: boolean, info: string) {
    if (!ok) allOk = false;
    details.push(`${ok ? "OK" : "FEHLER"}: ${label} — ${info}`);
  }

  const ctx = await findDemoHotelContext();
  const suffix = Date.now().toString(36);
  details.push(`Kontext: Demo Hotel ${ctx.hotelId}, owner ${ctx.userId}`);

  // ---- 1. Kategorie anlegen ----
  const roomType = await createRoomType(ctx, {
    name: `Verify-Kategorie-${suffix}`,
    code: `VK${suffix}`.slice(0, 8),
    capacityAdults: 2,
    capacityChildren: 1,
    baseRateCents: 12345,
    description: "Automatisch angelegt von scripts/verify-phase1/02-room-management.ts",
  });
  check(
    "createRoomType() legt korrekte Werte an",
    roomType.base_rate_cents === 12345 && roomType.capacity_adults === 2 && roomType.capacity_children === 1,
    `id=${roomType.id} base_rate_cents=${roomType.base_rate_cents} capacity=${roomType.capacity_adults}+${roomType.capacity_children}`
  );
  const auditCreated = await countAudit(ctx.hotelId, "room_type", roomType.id, "room_type.created");
  check("createRoomType() schreibt Audit-Log-Eintrag", auditCreated === 1, `${auditCreated} Eintrag/Einträge gefunden`);
  const eventCreated = await countEvents(ctx.hotelId, roomType.id, "room_type.created");
  check("createRoomType() schreibt Event", eventCreated === 1, `${eventCreated} Event(s) gefunden`);

  const listed = await listRoomTypes({ hotelId: ctx.hotelId });
  check(
    "Neue Kategorie erscheint in listRoomTypes() (= Belegungsplan-Filter/-Gruppe)",
    listed.some((rt) => rt.id === roomType.id),
    `${listed.length} Kategorien insgesamt geladen`
  );

  // ---- Kategorie aktualisieren ----
  const updatedType = await updateRoomType(ctx, {
    roomTypeId: roomType.id,
    name: `Verify-Kategorie-${suffix}-geaendert`,
    code: roomType.code,
    capacityAdults: 3,
    capacityChildren: 0,
    baseRateCents: 15000,
    description: roomType.description,
  });
  check(
    "updateRoomType() übernimmt neue Werte",
    updatedType.base_rate_cents === 15000 && updatedType.capacity_adults === 3,
    `base_rate_cents=${updatedType.base_rate_cents} capacity_adults=${updatedType.capacity_adults}`
  );
  const auditUpdated = await countAudit(ctx.hotelId, "room_type", roomType.id, "room_type.updated");
  check("updateRoomType() schreibt Audit-Log-Eintrag", auditUpdated === 1, `${auditUpdated} Eintrag/Einträge gefunden`);

  // ---- 4a. Negativkontrolle: ECHTE Kategorie mit Zimmern darf nicht deaktivierbar sein ----
  const pool = rawPool();
  const { rows: standardTypeRows } = await pool.query<{ id: string }>(
    `select id from room_types where hotel_id = $1 and name = 'Standard' and deleted_at is null`,
    [ctx.hotelId]
  );
  if (standardTypeRows[0]) {
    try {
      await deactivateRoomType(ctx, standardTypeRows[0].id);
      check("deactivateRoomType() blockiert Kategorie mit zugeordneten Zimmern (Standard)", false, "NICHT blockiert — Kategorie wurde deaktiviert!");
    } catch (e) {
      check(
        "deactivateRoomType() blockiert Kategorie mit zugeordneten Zimmern (Standard)",
        e instanceof ConflictError,
        e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
      );
    }
  } else {
    check("deactivateRoomType()-Blockade-Test (Standard)", false, "Kategorie 'Standard' im Demo Hotel nicht gefunden — Test übersprungen");
  }

  // ---- 2. Zimmer anlegen ----
  const room = await createRoom(ctx, {
    roomNumber: `V${suffix}`.slice(0, 12),
    floor: "V",
    roomTypeId: roomType.id,
  });
  check(
    "createRoom() legt korrekte Werte an",
    room.room_type_id === roomType.id && room.status === "available",
    `id=${room.id} room_type_id=${room.room_type_id} status=${room.status}`
  );
  const auditRoomCreated = await countAudit(ctx.hotelId, "room", room.id, "room.created");
  check("createRoom() schreibt Audit-Log-Eintrag", auditRoomCreated === 1, `${auditRoomCreated} Eintrag/Einträge gefunden`);
  const eventRoomCreated = await countEvents(ctx.hotelId, room.id, "room.created");
  check("createRoom() schreibt Event", eventRoomCreated === 1, `${eventRoomCreated} Event(s) gefunden`);

  // ---- 4b. Kategorie mit jetzt EINEM zugeordneten Zimmer darf ebenfalls nicht deaktivierbar sein ----
  try {
    await deactivateRoomType(ctx, roomType.id);
    check("deactivateRoomType() blockiert eigene Testkategorie mit 1 Zimmer", false, "NICHT blockiert!");
  } catch (e) {
    check(
      "deactivateRoomType() blockiert eigene Testkategorie mit 1 Zimmer",
      e instanceof ConflictError,
      e instanceof Error ? e.message : String(e)
    );
  }

  // ---- Zimmer aktualisieren ----
  const updatedRoom = await updateRoom(ctx, {
    roomId: room.id,
    roomNumber: room.room_number,
    floor: "V2",
    roomTypeId: roomType.id,
  });
  check("updateRoom() übernimmt neue Etage", updatedRoom.floor === "V2", `floor=${updatedRoom.floor}`);
  const auditRoomUpdated = await countAudit(ctx.hotelId, "room", room.id, "room.updated");
  check("updateRoom() schreibt Audit-Log-Eintrag", auditRoomUpdated === 1, `${auditRoomUpdated} Eintrag/Einträge gefunden`);

  // ---- Zimmerzustand ändern (Belegungsplan-Punkt) ----
  const cleaningRoom = await updateRoomStatus(ctx, { roomId: room.id, status: "cleaning" });
  check("updateRoomStatus() setzt 'cleaning'", cleaningRoom.status === "cleaning", `status=${cleaningRoom.status}`);
  await updateRoomStatus(ctx, { roomId: room.id, status: "available" });
  const auditStatus = await countAudit(ctx.hotelId, "room", room.id, "room.status_updated");
  check("updateRoomStatus() schreibt je Aufruf einen Audit-Log-Eintrag", auditStatus === 2, `${auditStatus} Einträge (erwartet: 2)`);

  // ---- 3. Zimmer außer Betrieb nehmen ----
  const deactivatedRoom = await deactivateRoom(ctx, room.id);
  check("deactivateRoom() setzt deleted_at", deactivatedRoom.deleted_at !== null, `deleted_at=${deactivatedRoom.deleted_at}`);
  const auditRoomDeactivated = await countAudit(ctx.hotelId, "room", room.id, "room.deactivated");
  check("deactivateRoom() schreibt Audit-Log-Eintrag", auditRoomDeactivated === 1, `${auditRoomDeactivated} Eintrag/Einträge gefunden`);

  const roomsAfterDeactivation = await listRooms({ hotelId: ctx.hotelId });
  check(
    "Außer Betrieb genommenes Zimmer verschwindet aus listRooms() (= Belegungsplan + Zimmerverwaltung)",
    !roomsAfterDeactivation.some((r) => r.id === room.id),
    `${roomsAfterDeactivation.length} aktive Zimmer nach Deaktivierung (Zimmer ${room.id} muss fehlen)`
  );

  // ---- 4c. Kategorie jetzt ohne Zimmer — deaktivieren muss durchgehen ----
  try {
    const finalType = await deactivateRoomType(ctx, roomType.id);
    check("deactivateRoomType() erlaubt Deaktivierung ohne zugeordnete Zimmer", finalType.deleted_at !== null, `deleted_at=${finalType.deleted_at}`);
  } catch (e) {
    check(
      "deactivateRoomType() erlaubt Deaktivierung ohne zugeordnete Zimmer",
      false,
      `Hätte durchgehen müssen: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  const auditTypeDeactivated = await countAudit(ctx.hotelId, "room_type", roomType.id, "room_type.deactivated");
  check("deactivateRoomType() schreibt Audit-Log-Eintrag", auditTypeDeactivated === 1, `${auditTypeDeactivated} Eintrag/Einträge gefunden`);

  const typesAfter = await listRoomTypes({ hotelId: ctx.hotelId });
  check(
    "Deaktivierte Kategorie verschwindet aus listRoomTypes() (= Belegungsplan-Filter)",
    !typesAfter.some((rt) => rt.id === roomType.id),
    `${typesAfter.length} aktive Kategorien nach Deaktivierung`
  );

  record(2, "Phase 1, Schritt 1 — Zimmerverwaltung + Kategorien-Verwaltung (Screen 8)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "Zimmerverwaltung + Kategorien-Verwaltung");
}

// Eigenständig ausführbar (`npx tsx scripts/verify-phase1/02-room-management.ts`),
// ohne die Zwei-Hotel-Fixtures aus run-all.ts anzulegen — dieser Test läuft
// gegen das echte Demo Hotel und braucht sie nicht. Feuert nicht, wenn die
// Datei nur importiert wird (z. B. von run-all.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([import("./_lib"), import("@lib/queue/boss")]).then(([{ printFinalReport, closeSharedPool }, { getBoss }]) => {
    testRoomManagement()
      .catch((e) => console.error("Test abgebrochen:", e instanceof Error ? e.message : e))
      .finally(async () => {
        printFinalReport();
        // executeWrite() initialisiert pg-boss beim ersten Event-Publish
        // (siehe modules/_shared/write.ts) — ohne stop() hängt der Prozess,
        // weil pg-boss seine eigene Verbindung offen hält (wie run-all.ts).
        try {
          const boss = await getBoss();
          await boss.stop({ close: true });
        } catch {
          // best effort
        }
        await closeSharedPool();
        process.exit(0);
      });
  });
}
