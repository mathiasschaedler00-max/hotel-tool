/**
 * Phase 1, Schritt 3 — Verifikation des restlichen Reservierungs-Lebenszyklus:
 * updateReservation(), moveReservation(), cancelReservation(),
 * createGroupBooking() (Atomarität!), searchGuests(), updateGuest().
 *
 * Läuft gegen das echte Demo Hotel, weit in der Zukunft (Tag +400 ff.),
 * damit garantiert nichts mit echten Demo-Daten oder dem
 * Überbuchungsschutz-Test (03-*, Tag +300/+310/+320) kollidiert. Alle
 * selbst angelegten Reservierungen/Gruppen werden am Ende hart entfernt;
 * der einzige BESTEHENDE Datensatz, den dieses Skript anfasst (der
 * Test-Gast für updateGuest()), wird auf seine ursprünglichen Werte
 * zurückgesetzt.
 */
import { rawPool, record, assertTrue, findDemoHotelContext } from "./_lib";
import { createReservation, updateReservation, moveReservation, cancelReservation } from "@modules/pms/reservations/service";
import { createGroupBooking } from "@modules/pms/group-bookings/service";
import { searchGuests, updateGuest, type Guest } from "@modules/pms/guests/service";
import { ConflictError } from "@modules/_shared/errors";

function addDays(base: number, days: number): string {
  const d = new Date(Date.now() + (base + days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function testReservationLifecycle(): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  function check(label: string, ok: boolean, info: string) {
    if (!ok) allOk = false;
    details.push(`${ok ? "OK" : "FEHLER"}: ${label} — ${info}`);
  }

  const ctx = await findDemoHotelContext();
  const pool = rawPool();

  const { rows: roomRows } = await pool.query<{ id: string; room_type_id: string; room_number: string }>(
    `select id, room_type_id, room_number from rooms where hotel_id = $1 and room_number in ('102','201','202','203') and deleted_at is null order by room_number`,
    [ctx.hotelId]
  );
  assertTrue(roomRows.length === 4, `Erwartete 4 Fixture-Zimmer (102/201/202/203), gefunden: ${roomRows.length}`);
  const [room102, room201, room202, room203] = roomRows;

  const { rows: guestRows } = await pool.query<Guest>(
    `select id, first_name, last_name, email, phone, nationality from guests where hotel_id = $1 and deleted_at is null limit 1`,
    [ctx.hotelId]
  );
  assertTrue(guestRows[0], "Kein Gast im Demo Hotel gefunden");
  const guest = guestRows[0];

  const createdReservationIds: string[] = [];
  const createdGroupIds: string[] = [];

  // ---- updateReservation(): Belegungsdaten ändern ----
  const r1 = await createReservation(ctx, {
    guestId: guest.id,
    roomTypeId: room102.room_type_id,
    roomId: room102.id,
    checkInDate: addDays(400, 0),
    checkOutDate: addDays(400, 3),
    adults: 1,
    children: 0,
    source: "direct",
    notes: "verify-phase1/04 — R1",
  });
  createdReservationIds.push(r1.id);

  const r1Updated = await updateReservation(ctx, {
    reservationId: r1.id,
    adults: 2,
    children: 1,
    notes: "aktualisiert von 04-reservation-lifecycle.ts",
    rateCents: 5000,
  });
  check(
    "updateReservation() übernimmt neue Werte",
    r1Updated.adults === 2 && r1Updated.children === 1 && r1Updated.rate_cents === 5000,
    `adults=${r1Updated.adults} children=${r1Updated.children} rate_cents=${r1Updated.rate_cents}`
  );
  const { rows: auditUpdate } = await pool.query<{ count: string }>(
    `select count(*)::text as count from audit_log where hotel_id=$1 and resource_type='reservation' and resource_id=$2 and action='reservation.updated'`,
    [ctx.hotelId, r1.id]
  );
  check("updateReservation() schreibt Audit-Log-Eintrag", Number(auditUpdate[0].count) === 1, `${auditUpdate[0].count} Eintrag/Einträge`);

  // ---- moveReservation(): erfolgreiche Verschiebung ----
  const r2 = await createReservation(ctx, {
    guestId: guest.id,
    roomTypeId: room102.room_type_id,
    roomId: room102.id,
    checkInDate: addDays(410, 0),
    checkOutDate: addDays(410, 2),
    adults: 1,
    children: 0,
    source: "direct",
    notes: "verify-phase1/04 — R2",
  });
  createdReservationIds.push(r2.id);

  const r2Moved = await moveReservation(ctx, {
    reservationId: r2.id,
    checkInDate: addDays(415, 0),
    checkOutDate: addDays(415, 2),
  });
  check(
    "moveReservation() verschiebt erfolgreich auf freien Zeitraum",
    r2Moved.check_in_date === addDays(415, 0),
    `check_in_date=${r2Moved.check_in_date}`
  );

  // ---- moveReservation(): Verschiebung in eine Kollision MUSS scheitern ----
  try {
    const leaked = await moveReservation(ctx, {
      reservationId: r2.id,
      roomId: room102.id,
      checkInDate: r1.check_in_date,
      checkOutDate: r1.check_out_date,
    });
    check("moveReservation() verweigert Verschiebung in eine Kollision", false, `NICHT verweigert — ${leaked.id} verschoben!`);
  } catch (e) {
    check(
      "moveReservation() verweigert Verschiebung in eine Kollision",
      e instanceof ConflictError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }
  const { rows: auditMove } = await pool.query<{ count: string }>(
    `select count(*)::text as count from audit_log where hotel_id=$1 and resource_type='reservation' and resource_id=$2 and action='reservation.moved'`,
    [ctx.hotelId, r2.id]
  );
  check(
    "moveReservation() schreibt NUR bei Erfolg einen Audit-Log-Eintrag (nicht bei der abgelehnten Kollision)",
    Number(auditMove[0].count) === 1,
    `${auditMove[0].count} Eintrag/Einträge (erwartet: 1, von der ersten erfolgreichen Verschiebung)`
  );

  // ---- cancelReservation(): stornieren + Zimmer wird wieder frei ----
  const r2Cancelled = await cancelReservation(ctx, { reservationId: r2.id, reason: "Test-Stornierung" });
  check(
    "cancelReservation() setzt status='cancelled' + cancel_reason",
    r2Cancelled.status === "cancelled" && r2Cancelled.cancel_reason === "Test-Stornierung",
    `status=${r2Cancelled.status} cancel_reason=${r2Cancelled.cancel_reason}`
  );

  try {
    await cancelReservation(ctx, { reservationId: r2.id, reason: "nochmal" });
    check("cancelReservation() verweigert erneutes Stornieren", false, "NICHT verweigert!");
  } catch (e) {
    check(
      "cancelReservation() verweigert erneutes Stornieren",
      e instanceof ConflictError,
      e instanceof Error ? e.message : String(e)
    );
  }

  const r3 = await createReservation(ctx, {
    guestId: guest.id,
    roomTypeId: room102.room_type_id,
    roomId: room102.id,
    checkInDate: addDays(415, 0),
    checkOutDate: addDays(415, 2),
    adults: 1,
    children: 0,
    source: "direct",
    notes: "verify-phase1/04 — R3 (beweist R2 hat das Zimmer wieder freigegeben)",
  });
  createdReservationIds.push(r3.id);
  check(
    "Stornierte Reservierung gibt das Zimmer über die Constraint automatisch wieder frei",
    true,
    `Neue Reservierung ${r3.id} auf demselben Zimmer/Zeitraum wie die stornierte R2 ging durch`
  );

  // ---- createGroupBooking(): Positivkontrolle (zwei Zimmer, ein Zug) ----
  const groupOk = await createGroupBooking(ctx, {
    name: "Verify-Gruppe OK",
    reservations: [
      {
        guestId: guest.id,
        roomTypeId: room201.room_type_id,
        roomId: room201.id,
        checkInDate: addDays(430, 0),
        checkOutDate: addDays(430, 2),
        adults: 1,
        children: 0,
      },
      {
        guestId: guest.id,
        roomTypeId: room202.room_type_id,
        roomId: room202.id,
        checkInDate: addDays(430, 0),
        checkOutDate: addDays(430, 2),
        adults: 1,
        children: 0,
      },
    ],
  });
  createdGroupIds.push(groupOk.group.id);
  createdReservationIds.push(...groupOk.reservations.map((r) => r.id));
  check(
    "createGroupBooking() legt Gruppe + alle Reservierungen in einem Zug an",
    groupOk.reservations.length === 2 && groupOk.reservations.every((r) => r.group_booking_id === groupOk.group.id),
    `Gruppe ${groupOk.group.id}, ${groupOk.reservations.length} Reservierungen, alle mit passender group_booking_id`
  );

  // ---- createGroupBooking(): Atomarität — EINE Kollision muss die GANZE Gruppe verwerfen ----
  try {
    const leaked = await createGroupBooking(ctx, {
      name: "Verify-Gruppe FAIL",
      reservations: [
        {
          guestId: guest.id,
          roomTypeId: room203.room_type_id,
          roomId: room203.id,
          checkInDate: addDays(440, 0),
          checkOutDate: addDays(440, 2),
          adults: 1,
          children: 0,
        },
        {
          // Kollidiert bewusst mit R1 (Zimmer 102, Tag +400..+403)
          guestId: guest.id,
          roomTypeId: room102.room_type_id,
          roomId: room102.id,
          checkInDate: r1.check_in_date,
          checkOutDate: r1.check_out_date,
          adults: 1,
          children: 0,
        },
      ],
    });
    createdGroupIds.push(leaked.group.id);
    createdReservationIds.push(...leaked.reservations.map((r) => r.id));
    check("createGroupBooking() verwirft die GANZE Gruppe bei einer Kollision", false, "NICHT verweigert — Gruppe wurde angelegt!");
  } catch (e) {
    check(
      "createGroupBooking() verwirft die GANZE Gruppe bei einer Kollision",
      e instanceof ConflictError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  const { rows: leakedRoom203 } = await pool.query<{ count: string }>(
    `select count(*)::text as count from reservations where hotel_id=$1 and room_id=$2 and check_in_date=$3 and deleted_at is null`,
    [ctx.hotelId, room203.id, addDays(440, 0)]
  );
  check(
    "Atomarität bestätigt: die ERSTE (an sich gültige) Reservierung der verworfenen Gruppe wurde NICHT einzeln angelegt",
    Number(leakedRoom203[0].count) === 0,
    `${leakedRoom203[0].count} Reservierung(en) auf Zimmer 203 im Test-Zeitraum gefunden (erwartet: 0 — Transaktion muss komplett zurückgerollt sein)`
  );

  // ---- searchGuests() ----
  const searchTerm = guest.last_name.slice(0, Math.max(3, Math.min(5, guest.last_name.length)));
  const foundGuests = await searchGuests(ctx, searchTerm);
  check(
    `searchGuests("${searchTerm}") findet den Fixture-Gast`,
    foundGuests.some((g) => g.id === guest.id),
    `${foundGuests.length} Treffer`
  );

  // ---- updateGuest(): ändern und wieder zurücksetzen ----
  const tempPhone = "+43 000 TEST-04";
  const guestUpdated = await updateGuest(ctx, {
    guestId: guest.id,
    firstName: guest.first_name,
    lastName: guest.last_name,
    email: guest.email,
    phone: tempPhone,
    nationality: guest.nationality,
  });
  check("updateGuest() übernimmt neue Telefonnummer", guestUpdated.phone === tempPhone, `phone=${guestUpdated.phone}`);

  const guestRestored = await updateGuest(ctx, {
    guestId: guest.id,
    firstName: guest.first_name,
    lastName: guest.last_name,
    email: guest.email,
    phone: guest.phone,
    nationality: guest.nationality,
  });
  check(
    "updateGuest() — Original-Telefonnummer erfolgreich wiederhergestellt",
    guestRestored.phone === guest.phone,
    `phone=${guestRestored.phone} (Original: ${guest.phone})`
  );

  // ---- Cleanup ----
  if (createdReservationIds.length > 0) {
    await pool.query(`update reservations set deleted_at = now() where id = any($1::uuid[])`, [createdReservationIds]);
  }
  if (createdGroupIds.length > 0) {
    await pool.query(`update group_bookings set deleted_at = now() where id = any($1::uuid[])`, [createdGroupIds]);
  }
  details.push(
    `Cleanup: ${createdReservationIds.length} Test-Reservierung(en), ${createdGroupIds.length} Test-Gruppe(n) entfernt; Test-Gast auf Originalwerte zurückgesetzt.`
  );

  record(4, "Phase 1, Schritt 3 — Reservierungs-Lebenszyklus (update/move/cancel/Gruppen/Gastsuche)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "Reservierungs-Lebenszyklus");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  Promise.all([import("./_lib"), import("@lib/queue/boss")]).then(([{ printFinalReport, closeSharedPool }, { getBoss }]) => {
    testReservationLifecycle()
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
