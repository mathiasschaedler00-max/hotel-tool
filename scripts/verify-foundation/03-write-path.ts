/**
 * Punkt 3 der Abnahme: kompletter transaktionaler Schreibpfad.
 *
 * (a) `createReservation()` fuer Hotel A ueber `executeWrite()` aufrufen,
 *     danach per SQL pruefen: reservations-Row, audit_log-Eintrag
 *     (old_data/new_data/actor_role/request_id), events-Eintrag — alles aus
 *     GENAU einem Aufruf.
 * (b) Atomaritaets-Probe: `executeWrite()` direkt mit einer `mutate`-Funktion
 *     aufrufen, die einen echten Insert vornimmt und danach bewusst wirft —
 *     zeigt, dass ein Fehlschlag NACH einem erfolgreichen Low-Level-Insert
 *     die gesamte Transaktion zurückrollt (kein Teil-Erfolg).
 */
import { randomUUID } from "node:crypto";
import { rawPool, record, assertTrue } from "./_lib";
import type { Fixtures } from "./01-setup";
import { createReservation } from "@modules/pms/reservations/service";
import { executeWrite } from "@modules/_shared/write";
import { createSystemContext, type ModuleContext } from "@modules/_shared/context";

export interface WritePathResult {
  reservationId: string;
}

export async function testWritePath(fixtures: Fixtures): Promise<WritePathResult> {
  const details: string[] = [];
  let allOk = true;
  const pool = rawPool();

  const ctx: ModuleContext = {
    userId: fixtures.hotelA.frontOffice.id,
    hotelId: fixtures.hotelA.id,
    role: "front_office",
    requestId: randomUUID(),
    module: "pms",
  };

  const reservation = await createReservation(ctx, {
    guestId: fixtures.hotelA.guestId,
    roomTypeId: fixtures.hotelA.roomTypeId,
    roomId: fixtures.hotelA.roomId,
    checkInDate: "2026-10-01",
    checkOutDate: "2026-10-04",
    adults: 2,
    children: 1,
    source: "direct",
    notes: "Abnahmetest Punkt 3 — kompletter Schreibpfad",
  });
  details.push(`createReservation() aufgerufen -> reservation.id=${reservation.id}, status=${reservation.status}`);

  // --- (a1) reservations-Row ---
  const { rows: resRows } = await pool.query(
    `select * from reservations where id = $1 and hotel_id = $2 and deleted_at is null`,
    [reservation.id, fixtures.hotelA.id]
  );
  if (resRows.length !== 1) {
    allOk = false;
    details.push(`FEHLER: erwartet genau 1 reservations-Row, gefunden: ${resRows.length}`);
  } else {
    details.push(`reservations-Row existiert (1 Zeile, hotel_id korrekt).`);
  }

  // --- (a2) audit_log-Eintrag ---
  const { rows: auditRows } = await pool.query(
    `select * from audit_log where resource_type = 'reservation' and resource_id = $1 and action = 'reservation.created'`,
    [reservation.id]
  );
  if (auditRows.length !== 1) {
    allOk = false;
    details.push(`FEHLER: erwartet genau 1 audit_log-Eintrag, gefunden: ${auditRows.length}`);
  } else {
    const a = auditRows[0];
    const checks = [
      [a.hotel_id === fixtures.hotelA.id, "hotel_id korrekt"],
      [a.actor_user_id === fixtures.hotelA.frontOffice.id, "actor_user_id korrekt"],
      [a.actor_role === "front_office", "actor_role korrekt ('front_office')"],
      [a.module === "pms", "module korrekt ('pms')"],
      [a.old_data === null, "old_data korrekt NULL (Create hat kein 'before')"],
      [a.new_data?.id === reservation.id, "new_data enthaelt die neue Reservierung"],
      [a.request_id === ctx.requestId, "request_id stimmt mit ctx.requestId ueberein"],
    ] as const;
    for (const [ok, label] of checks) {
      if (!ok) allOk = false;
      details.push(`audit_log: ${label} — ${ok ? "OK" : "FEHLER"}`);
    }
  }

  // --- (a3) events-Eintrag ---
  const { rows: eventRows } = await pool.query(
    `select * from events where aggregate_type = 'reservation' and aggregate_id = $1 and event_type = 'reservation.created'`,
    [reservation.id]
  );
  if (eventRows.length !== 1) {
    allOk = false;
    details.push(`FEHLER: erwartet genau 1 events-Eintrag, gefunden: ${eventRows.length}`);
  } else {
    const ev = eventRows[0];
    const payloadOk = ev.payload?.reservationId === reservation.id && ev.payload?.hotelId === fixtures.hotelA.id;
    if (!payloadOk) allOk = false;
    details.push(`events-Row existiert, aggregate_id/event_type korrekt, payload ${payloadOk ? "OK" : "FEHLERHAFT"}.`);
  }

  // --- (b) Atomaritaets-Probe ---
  const probeCtx = createSystemContext(fixtures.hotelA.id, "test-atomicity");
  let probeGuestId: string | undefined;
  let rolledBack = false;
  try {
    await executeWrite(probeCtx, {
      resourceType: "atomicity_probe",
      action: "test.atomicity_probe",
      mutate: async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into guests (hotel_id, first_name, last_name) values ($1,'Atomicity','Probe') returning id`,
          [fixtures.hotelA.id]
        );
        probeGuestId = rows[0].id;
        // Bewusster Fehlschlag NACH einem erfolgreichen Low-Level-Insert —
        // muss die komplette Transaktion (inkl. dieses Inserts) zurueckrollen.
        throw new Error("Absichtlicher Fehlschlag zur Atomaritaets-Pruefung");
      },
    });
  } catch (e) {
    rolledBack = e instanceof Error && e.message.includes("Absichtlicher Fehlschlag");
  }

  if (!probeGuestId) {
    allOk = false;
    details.push("FEHLER: Atomaritaets-Probe konnte keinen Insert durchfuehren (Testaufbau fehlerhaft).");
  } else if (!rolledBack) {
    allOk = false;
    details.push("FEHLER: executeWrite() hat den erwarteten Fehler nicht durchgereicht.");
  } else {
    const { rows: probeRows } = await pool.query(`select 1 from guests where id = $1`, [probeGuestId]);
    if (probeRows.length !== 0) {
      allOk = false;
      details.push(
        `FEHLER: Atomaritaet verletzt! guests-Row ${probeGuestId} existiert trotz Fehlschlag nach dem Insert — kein Rollback.`
      );
    } else {
      details.push(
        `Atomaritaets-Probe bestanden: executeWrite() hat einen echten Insert (guests-Row ${probeGuestId}) + anschliessenden Fehler ` +
          `in EINER Transaktion zurueckgerollt — die Row existiert danach nachweislich nicht mehr (0 Zeilen). Kein Teil-Erfolg moeglich.`
      );
    }
  }

  record(
    3,
    "Kompletter Schreibpfad (createReservation -> executeWrite, atomar)",
    allOk ? "PASS" : "FAIL",
    details.join("\n")
  );
  assertTrue(allOk, "Kompletter Schreibpfad");

  return { reservationId: reservation.id };
}
