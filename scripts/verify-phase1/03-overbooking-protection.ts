/**
 * Phase 1, Schritt 3 — Verifikation des harten Überbuchungsschutzes
 * (Migration `20260823010000_no_double_booking_constraint.sql`).
 *
 * Laut Plan ("Besonders wichtige Einzelprüfungen", Schritt 3): "zwei
 * überlappende Buchungen auf dasselbe Zimmer müssen scheitern — einmal
 * sequenziell, einmal NEBENLÄUFIG (zwei gleichzeitige Transaktionen),
 * sonst ist nur die freundliche Vorprüfung getestet und nicht der
 * Constraint." Genau das prüft dieses Skript, plus die rate_cents-
 * Vorbelegung und die freundliche `listAvailableRooms()`-Vorabprüfung.
 *
 * Läuft gegen das echte Demo Hotel, Zeitraum weit in der Zukunft (Tag
 * +300 ff.), damit garantiert keine echten Demo-Buchungen kollidieren.
 * Alle selbst angelegten Reservierungen werden am Ende hart entfernt
 * (kein `cancelReservation()` vorhanden — das kommt als nächstes in
 * Schritt 3 — daher direktes SQL-Cleanup wie bei den übrigen
 * Testdaten in dieser Session).
 */
import { rawPool, record, assertTrue, findDemoHotelContext } from "./_lib";
import { createReservation, listAvailableRooms } from "@modules/pms/reservations/service";
import { ConflictError } from "@modules/_shared/errors";

function addDays(base: number, days: number): string {
  const d = new Date(Date.now() + (base + days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function testOverbookingProtection(): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  function check(label: string, ok: boolean, info: string) {
    if (!ok) allOk = false;
    details.push(`${ok ? "OK" : "FEHLER"}: ${label} — ${info}`);
  }

  const ctx = await findDemoHotelContext();
  const pool = rawPool();

  const { rows: roomRows } = await pool.query<{ id: string; room_type_id: string; room_number: string }>(
    `select id, room_type_id, room_number from rooms where hotel_id = $1 and room_number = '101' and deleted_at is null`,
    [ctx.hotelId]
  );
  assertTrue(roomRows[0], "Zimmer 101 im Demo Hotel nicht gefunden");
  const room = roomRows[0];

  const { rows: guestRows } = await pool.query<{ id: string }>(
    `select id from guests where hotel_id = $1 and deleted_at is null limit 1`,
    [ctx.hotelId]
  );
  assertTrue(guestRows[0], "Kein Gast im Demo Hotel gefunden");
  const guestId = guestRows[0].id;

  const { rows: typeRows } = await pool.query<{ base_rate_cents: number }>(
    `select base_rate_cents from room_types where id = $1`,
    [room.room_type_id]
  );
  const baseRateCents = typeRows[0].base_rate_cents;
  details.push(`Fixture: Zimmer ${room.room_number} (${room.id}), Kategorie-Basispreis ${baseRateCents} Cent/Nacht.`);

  const createdReservationIds: string[] = [];

  // ---- rate_cents-Vorbelegung + Positivkontrolle (nicht überlappend) ----
  const resA = await createReservation(ctx, {
    guestId,
    roomTypeId: room.room_type_id,
    roomId: room.id,
    checkInDate: addDays(300, 0),
    checkOutDate: addDays(300, 3),
    adults: 1,
    children: 0,
    source: "direct",
    notes: "verify-phase1/03-overbooking-protection.ts — Fixture A",
  });
  createdReservationIds.push(resA.id);
  check(
    "createReservation() Positivkontrolle geht durch",
    true,
    `Reservierung ${resA.id} angelegt (${resA.check_in_date} – ${resA.check_out_date})`
  );
  check(
    "rate_cents wird korrekt aus base_rate_cents × Nächte vorbelegt",
    resA.rate_cents === baseRateCents * 3,
    `rate_cents=${resA.rate_cents}, erwartet ${baseRateCents} × 3 = ${baseRateCents * 3}`
  );

  const { rows: auditRows } = await pool.query<{ count: string }>(
    `select count(*)::text as count from audit_log where hotel_id = $1 and resource_type = 'reservation' and resource_id = $2 and action = 'reservation.created'`,
    [ctx.hotelId, resA.id]
  );
  check("createReservation() schreibt Audit-Log-Eintrag", Number(auditRows[0].count) === 1, `${auditRows[0].count} Eintrag/Einträge`);

  // ---- Sequenzielle Überlappung MUSS scheitern ----
  try {
    const leaked = await createReservation(ctx, {
      guestId,
      roomTypeId: room.room_type_id,
      roomId: room.id,
      checkInDate: addDays(300, 1), // überlappt A (0–3)
      checkOutDate: addDays(300, 4),
      adults: 1,
      children: 0,
      source: "direct",
      notes: "verify-phase1/03-overbooking-protection.ts — sequenzieller Überlappungsversuch",
    });
    createdReservationIds.push(leaked.id);
    check("Sequenzielle Überlappung wird verweigert", false, `NICHT verweigert — Reservierung ${leaked.id} wurde angelegt!`);
  } catch (e) {
    check(
      "Sequenzielle Überlappung wird verweigert",
      e instanceof ConflictError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  // ---- Anschlussbuchung (Abreisetag = nächster Anreisetag) MUSS gehen ----
  const resC = await createReservation(ctx, {
    guestId,
    roomTypeId: room.room_type_id,
    roomId: room.id,
    checkInDate: addDays(300, 3), // A's Abreisetag — muss frei sein
    checkOutDate: addDays(300, 5),
    adults: 1,
    children: 0,
    source: "direct",
    notes: "verify-phase1/03-overbooking-protection.ts — Anschlussbuchung am Abreisetag",
  });
  createdReservationIds.push(resC.id);
  check(
    "Anschlussbuchung direkt am Abreisetag (halboffenes Intervall) wird erlaubt",
    true,
    `Reservierung ${resC.id} angelegt (${resC.check_in_date} – ${resC.check_out_date})`
  );

  // ---- Nebenläufige Überlappung: zwei GLEICHZEITIGE Requests, exakt einer darf durchgehen ----
  const concurrentCheckIn = addDays(310, 0);
  const concurrentCheckOut = addDays(310, 2);
  const [settledX, settledY] = await Promise.allSettled([
    createReservation(ctx, {
      guestId,
      roomTypeId: room.room_type_id,
      roomId: room.id,
      checkInDate: concurrentCheckIn,
      checkOutDate: concurrentCheckOut,
      adults: 1,
      children: 0,
      source: "direct",
      notes: "verify-phase1/03-overbooking-protection.ts — nebenläufig X",
    }),
    createReservation(ctx, {
      guestId,
      roomTypeId: room.room_type_id,
      roomId: room.id,
      checkInDate: concurrentCheckIn,
      checkOutDate: concurrentCheckOut,
      adults: 1,
      children: 0,
      source: "direct",
      notes: "verify-phase1/03-overbooking-protection.ts — nebenläufig Y",
    }),
  ]);
  const fulfilled = [settledX, settledY].filter((r) => r.status === "fulfilled");
  const rejected = [settledX, settledY].filter((r) => r.status === "rejected");
  for (const r of fulfilled) createdReservationIds.push((r as PromiseFulfilledResult<{ id: string }>).value.id);
  const rejectedIsConflict =
    rejected.length === 1 && (rejected[0] as PromiseRejectedResult).reason instanceof ConflictError;
  check(
    "Nebenläufige Überlappung: genau EINE der beiden gleichzeitigen Anfragen geht durch",
    fulfilled.length === 1 && rejected.length === 1 && rejectedIsConflict,
    `erfolgreich=${fulfilled.length}, abgelehnt=${rejected.length}, Ablehnung war ConflictError=${rejectedIsConflict}`
  );

  // ---- Nicht zugewiesene Reservierungen (room_id null) dürfen sich überlappen ----
  const unassignedA = await createReservation(ctx, {
    guestId,
    roomTypeId: room.room_type_id,
    checkInDate: addDays(320, 0),
    checkOutDate: addDays(320, 2),
    adults: 1,
    children: 0,
    source: "channel_manager",
    notes: "verify-phase1/03-overbooking-protection.ts — unzugewiesen A",
  });
  const unassignedB = await createReservation(ctx, {
    guestId,
    roomTypeId: room.room_type_id,
    checkInDate: addDays(320, 0),
    checkOutDate: addDays(320, 2),
    adults: 1,
    children: 0,
    source: "channel_manager",
    notes: "verify-phase1/03-overbooking-protection.ts — unzugewiesen B",
  });
  createdReservationIds.push(unassignedA.id, unassignedB.id);
  check(
    "Zwei überlappende, nicht zugewiesene Reservierungen (room_id null) sind erlaubt",
    unassignedA.room_id === null && unassignedB.room_id === null,
    `A.room_id=${unassignedA.room_id}, B.room_id=${unassignedB.room_id}`
  );

  // ---- listAvailableRooms(): freundliche Vorabprüfung ----
  const availableDuringA = await listAvailableRooms(ctx, addDays(300, 0), addDays(300, 3), room.room_type_id);
  check(
    "listAvailableRooms() schließt belegtes Zimmer 101 im gebuchten Zeitraum aus",
    !availableDuringA.some((r) => r.id === room.id),
    `${availableDuringA.length} verfügbare Zimmer der Kategorie im Zeitraum von Reservierung A`
  );
  const availableBeforeA = await listAvailableRooms(ctx, addDays(290, 0), addDays(290, 2), room.room_type_id);
  check(
    "listAvailableRooms() listet Zimmer 101 in einem freien Zeitraum",
    availableBeforeA.some((r) => r.id === room.id),
    `${availableBeforeA.length} verfügbare Zimmer der Kategorie in einem unbelegten Zeitraum`
  );

  // ---- Cleanup: alle selbst angelegten Reservierungen wieder entfernen ----
  if (createdReservationIds.length > 0) {
    await pool.query(`update reservations set deleted_at = now() where id = any($1::uuid[])`, [createdReservationIds]);
  }
  details.push(`Cleanup: ${createdReservationIds.length} Test-Reservierung(en) wieder entfernt (soft-delete).`);

  record(
    3,
    "Phase 1, Schritt 3 — Überbuchungsschutz (no_double_booking-Constraint)",
    allOk ? "PASS" : "FAIL",
    details.join("\n")
  );
  assertTrue(allOk, "Überbuchungsschutz");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([import("./_lib"), import("@lib/queue/boss")]).then(([{ printFinalReport, closeSharedPool }, { getBoss }]) => {
    testOverbookingProtection()
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
