/**
 * Phase 1, Schritt 4 — Verifikation von Check-in / Zimmerzuteilung / Check-out.
 *
 * Prüft insbesondere die drei Punkte, die der Plan als leicht übersehbar
 * markiert hat:
 *  - die bis hierhin TOTE KETTE: ohne checkIn() konnte nie etwas `checked_in`
 *    werden, wodurch checkOut() unerreichbar war,
 *  - die Housekeeping-Sperre samt Override, der den Zimmerstatus MITKORRIGIERT
 *    (sonst laufen Belegungsplan und Housekeeping dauerhaft auseinander),
 *  - Check-out setzt das Zimmer auf `cleaning`, in derselben Transaktion.
 *
 * Läuft weit in der Zukunft (Tag +500 ff.), damit garantiert nichts mit
 * Demo-Daten oder den Skripten 03-/04-* kollidiert. Alle selbst angelegten
 * Daten werden am Ende hart entfernt, angefasste Bestandsdaten (Zimmerstatus)
 * auf den Ausgangswert zurückgesetzt.
 */
import { rawPool, record, assertTrue, findDemoHotelContext } from "./_lib";
import { createReservation, checkIn, assignRoom, checkOut } from "@modules/pms/reservations/service";
import { ConflictError } from "@modules/_shared/errors";

function addDays(base: number, days: number): string {
  const d = new Date(Date.now() + (base + days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function testCheckInOut(): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  function check(label: string, ok: boolean, info: string) {
    if (!ok) allOk = false;
    details.push(`${ok ? "OK" : "FEHLER"}: ${label} — ${info}`);
  }

  const ctx = await findDemoHotelContext();
  const pool = rawPool();

  const { rows: roomRows } = await pool.query<{ id: string; room_type_id: string; room_number: string; status: string }>(
    `select id, room_type_id, room_number, status from rooms
      where hotel_id = $1 and room_number in ('201','202','203') and deleted_at is null order by room_number`,
    [ctx.hotelId]
  );
  assertTrue(roomRows.length === 3, `Erwartete 3 Fixture-Zimmer (201/202/203), gefunden: ${roomRows.length}`);
  const [roomA, roomB, roomC] = roomRows;
  const originalStatus = new Map(roomRows.map((r) => [r.id, r.status]));

  const { rows: guestRows } = await pool.query<{ id: string }>(
    `select id from guests where hotel_id = $1 and deleted_at is null limit 1`,
    [ctx.hotelId]
  );
  assertTrue(guestRows[0], "Kein Gast im Demo Hotel gefunden");
  const guestId = guestRows[0].id;

  const createdReservationIds: string[] = [];
  const createdFolioIds: string[] = [];

  try {
    // ---------- 1) Check-in schließt die tote Kette ----------
    const res1 = await createReservation(ctx, {
      guestId,
      roomTypeId: roomA.room_type_id,
      roomId: roomA.id,
      checkInDate: addDays(500, 0),
      checkOutDate: addDays(500, 2),
      adults: 1,
      children: 0,
      source: "direct",
    });
    createdReservationIds.push(res1.id);

    // Ausgangslage: Zimmer bezugsfertig
    await pool.query(`update rooms set status = 'available' where id = $1`, [roomA.id]);

    const checkedIn = await checkIn(ctx, { reservationId: res1.id, overrideRoomStatus: false });
    check("Check-in setzt Status", checkedIn.status === "checked_in", `status=${checkedIn.status}`);

    // ---------- 2) Folio wird beim Check-in geöffnet ----------
    const { rows: folioRows } = await pool.query<{ id: string; status: string }>(
      `select id, status from folios where reservation_id = $1 and deleted_at is null`,
      [res1.id]
    );
    check("Folio beim Check-in eröffnet", folioRows.length === 1 && folioRows[0].status === "open",
      `${folioRows.length} Folio(s), status=${folioRows[0]?.status}`);
    folioRows.forEach((f) => createdFolioIds.push(f.id));

    // ---------- 3) Zimmerstatus bleibt unangetastet ("Belegt" ist abgeleitet) ----------
    const { rows: roomAfterCheckin } = await pool.query<{ status: string }>(
      `select status from rooms where id = $1`, [roomA.id]);
    check("Check-in fasst rooms.status nicht an", roomAfterCheckin[0].status === "available",
      `status=${roomAfterCheckin[0].status} (Belegt wird aus reservations.status abgeleitet)`);

    // ---------- 4) Doppelter Check-in wird abgelehnt ----------
    let secondCheckInRejected = false;
    try {
      await checkIn(ctx, { reservationId: res1.id, overrideRoomStatus: false });
    } catch (e) {
      secondCheckInRejected = e instanceof ConflictError;
    }
    check("Zweiter Check-in abgelehnt", secondCheckInRejected, "ConflictError erwartet");

    // ---------- 5) Housekeeping-Sperre: Zimmer in Reinigung ----------
    const res2 = await createReservation(ctx, {
      guestId,
      roomTypeId: roomB.room_type_id,
      roomId: roomB.id,
      checkInDate: addDays(500, 0),
      checkOutDate: addDays(500, 2),
      adults: 1,
      children: 0,
      source: "direct",
    });
    createdReservationIds.push(res2.id);
    await pool.query(`update rooms set status = 'cleaning' where id = $1`, [roomB.id]);

    let blocked: ConflictError | null = null;
    try {
      await checkIn(ctx, { reservationId: res2.id, overrideRoomStatus: false });
    } catch (e) {
      if (e instanceof ConflictError) blocked = e;
    }
    check("Check-in in ungereinigtes Zimmer blockiert", blocked !== null,
      blocked ? `abgelehnt: ${blocked.message}` : "wurde NICHT abgelehnt");
    check("Ablehnung markiert Override-Möglichkeit",
      (blocked?.details as { requiresOverride?: boolean } | undefined)?.requiresOverride === true,
      `details.requiresOverride=${(blocked?.details as { requiresOverride?: boolean } | undefined)?.requiresOverride}`);

    // ---------- 6) Override ohne Begründung wird abgelehnt ----------
    let overrideWithoutReasonRejected = false;
    try {
      await checkIn(ctx, { reservationId: res2.id, overrideRoomStatus: true });
    } catch {
      overrideWithoutReasonRejected = true;
    }
    check("Override ohne Begründung abgelehnt", overrideWithoutReasonRejected, "ValidationError erwartet");

    // ---------- 7) Override korrigiert den Zimmerstatus MIT (Kern der Plan-Warnung) ----------
    const overridden = await checkIn(ctx, {
      reservationId: res2.id,
      overrideRoomStatus: true,
      overrideReason: "Zimmer vor Ort geprüft, ist sauber",
    });
    check("Check-in mit Override erfolgreich", overridden.status === "checked_in", `status=${overridden.status}`);

    const { rows: roomBAfter } = await pool.query<{ status: string }>(
      `select status from rooms where id = $1`, [roomB.id]);
    check("Override korrigiert Zimmerstatus mit", roomBAfter[0].status === "available",
      `status=${roomBAfter[0].status} (sonst laufen Belegungsplan und Housekeeping auseinander)`);

    const { rows: overrideAudit } = await pool.query<{ action: string; new_data: Record<string, unknown> }>(
      `select action, new_data from audit_log where resource_id = $1 and action = 'room.status_overridden_at_checkin'`,
      [roomB.id]
    );
    check("Override eigener Audit-Eintrag", overrideAudit.length === 1,
      `${overrideAudit.length} Eintrag/Einträge, Grund="${overrideAudit[0]?.new_data?.reason}"`);

    // ---------- 8) Check-out setzt Zimmer auf Reinigung ----------
    const checkedOut = await checkOut(ctx, { reservationId: res1.id, allowOpenBalance: false });
    check("Check-out setzt Status", checkedOut.status === "checked_out", `status=${checkedOut.status}`);

    const { rows: roomAAfterOut } = await pool.query<{ status: string }>(
      `select status from rooms where id = $1`, [roomA.id]);
    check("Check-out setzt Zimmer auf Reinigung", roomAAfterOut[0].status === "cleaning",
      `status=${roomAAfterOut[0].status}`);

    // ---------- 9) Zimmer nach Check-out wieder buchbar (Constraint greift nur bei confirmed/checked_in) ----------
    const res3 = await createReservation(ctx, {
      guestId,
      roomTypeId: roomA.room_type_id,
      roomId: roomA.id,
      checkInDate: addDays(500, 0),
      checkOutDate: addDays(500, 2),
      adults: 1,
      children: 0,
      source: "direct",
    });
    createdReservationIds.push(res3.id);
    check("Zimmer nach Check-out wieder buchbar", res3.room_id === roomA.id,
      "Überschneidung mit ausgecheckter Buchung ist erlaubt");

    // ---------- 10) assignRoom(): Zuteilung ohne Check-in ----------
    const res4 = await createReservation(ctx, {
      guestId,
      roomTypeId: roomC.room_type_id,
      checkInDate: addDays(510, 0),
      checkOutDate: addDays(510, 2),
      adults: 1,
      children: 0,
      source: "direct",
    });
    createdReservationIds.push(res4.id);
    check("Reservierung startet ohne Zimmer", res4.room_id === null, `room_id=${res4.room_id}`);

    await pool.query(`update rooms set status = 'available' where id = $1`, [roomC.id]);
    const assigned = await assignRoom(ctx, { reservationId: res4.id, roomId: roomC.id, overrideRoomStatus: false });
    check("assignRoom weist Zimmer zu", assigned.room_id === roomC.id, `room_id=${assigned.room_id}`);
    check("assignRoom checkt NICHT ein", assigned.status === "confirmed", `status=${assigned.status}`);

    // ---------- 11) assignRoom respektiert dieselbe Housekeeping-Sperre ----------
    await pool.query(`update rooms set status = 'maintenance' where id = $1`, [roomC.id]);
    let assignBlocked = false;
    try {
      await assignRoom(ctx, { reservationId: res4.id, roomId: roomC.id, overrideRoomStatus: false });
    } catch (e) {
      assignBlocked = e instanceof ConflictError;
    }
    check("assignRoom blockiert bei Wartung", assignBlocked, "ConflictError erwartet");

    // ---------- 12) Check-out einer nicht eingecheckten Buchung abgelehnt ----------
    let checkOutBlocked = false;
    try {
      await checkOut(ctx, { reservationId: res4.id, allowOpenBalance: false });
    } catch (e) {
      checkOutBlocked = e instanceof ConflictError;
    }
    check("Check-out ohne Check-in abgelehnt", checkOutBlocked, "ConflictError erwartet");
  } finally {
    // ---------- Aufräumen ----------
    if (createdFolioIds.length > 0) {
      await pool.query(`delete from audit_log where resource_id = any($1)`, [createdFolioIds]);
      await pool.query(`delete from folios where id = any($1)`, [createdFolioIds]);
    }
    if (createdReservationIds.length > 0) {
      await pool.query(
        `delete from folios where reservation_id = any($1)`, [createdReservationIds]);
      await pool.query(`delete from audit_log where resource_id = any($1)`, [createdReservationIds]);
      await pool.query(`delete from events where aggregate_id = any($1)`, [createdReservationIds]);
      await pool.query(`delete from reservations where id = any($1)`, [createdReservationIds]);
    }
    for (const [roomId, status] of originalStatus) {
      await pool.query(`delete from audit_log where resource_id = $1 and action = 'room.status_overridden_at_checkin'`, [roomId]);
      await pool.query(`update rooms set status = $2 where id = $1`, [roomId, status]);
    }
    details.push(
      `Aufgeräumt: ${createdReservationIds.length} Reservierungen, zugehörige Folios/Events, ` +
        `${originalStatus.size} Zimmerstatus zurückgesetzt.`
    );
  }

  record(
    5,
    "Phase 1, Schritt 4 — Check-in / Zimmerzuteilung / Check-out (inkl. Housekeeping-Override)",
    allOk ? "PASS" : "FAIL",
    details.join("\n")
  );
  assertTrue(allOk, "Check-in/Check-out");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([import("./_lib"), import("@lib/queue/boss")]).then(([{ printFinalReport, closeSharedPool }, { getBoss }]) => {
    testCheckInOut()
      .catch((e) => console.error("Test abgebrochen:", e instanceof Error ? e.message : e))
      .finally(async () => {
        printFinalReport();
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
