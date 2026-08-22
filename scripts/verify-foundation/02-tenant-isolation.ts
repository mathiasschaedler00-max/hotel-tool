/**
 * Punkt 2 der Abnahme: Mandantentrennung.
 *
 * (a) RLS (erste Verteidigungslinie beim lesenden Browser-Client, siehe
 *     ARCHITECTURE.md): User A meldet sich über den ANON-Key-Client
 *     (`signInWithPassword`, echte Session, RLS aktiv) an und versucht, eine
 *     Reservierung von Hotel B zu lesen/schreiben — muss leer/verweigert sein.
 *
 * (b) RBAC/Modul-Ebene (zweite Verteidigungslinie): `createReservation()`
 *     direkt mit einem `ModuleContext` aufrufen, der zu Hotel A gehört, aber
 *     eine Hotel-B-Guest-/RoomType-ID im Payload referenziert — muss verweigert
 *     werden. Zusätzlich ein reiner RBAC-Test (Rolle ohne die nötige
 *     Permission) gegen `requirePermission()`.
 */
import { randomUUID } from "node:crypto";
import { anonClient, rawPool, record, assertTrue } from "./_lib";
import type { Fixtures } from "./01-setup";
import { createReservation } from "@modules/pms/reservations/service";
import { NotFoundError, ForbiddenError } from "@modules/_shared/errors";
import type { ModuleContext } from "@modules/_shared/context";

async function ensureHotelBReservation(fixtures: Fixtures): Promise<string> {
  const ctx: ModuleContext = {
    userId: fixtures.hotelB.owner.id,
    hotelId: fixtures.hotelB.id,
    role: "owner",
    requestId: randomUUID(),
    module: "pms",
  };
  const reservation = await createReservation(ctx, {
    guestId: fixtures.hotelB.guestId,
    roomTypeId: fixtures.hotelB.roomTypeId,
    roomId: fixtures.hotelB.roomId,
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-03",
    adults: 2,
    children: 0,
    source: "direct",
    notes: "Fixture fuer Mandantentrennungs-Test",
  });
  return reservation.id;
}

export async function testTenantIsolation(fixtures: Fixtures): Promise<void> {
  const details: string[] = [];
  let allOk = true;

  // --- Fixture: echte Reservierung in Hotel B, damit es etwas zum
  //     "verbotenerweise lesen" gibt. ---
  const reservationBId = await ensureHotelBReservation(fixtures);
  details.push(`Fixture: Reservierung in Hotel B angelegt (id=${reservationBId}) als Angriffsziel.`);

  // --- (a) RLS über den Anon-Key-Client mit echter Session von User A ---
  const client = anonClient();
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: fixtures.hotelA.frontOffice.email,
    password: fixtures.hotelA.frontOffice.password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`signInWithPassword fuer Hotel-A-User fehlgeschlagen: ${signInError?.message}`);
  }
  details.push(`Echte Session fuer ${fixtures.hotelA.frontOffice.email} (Hotel A, front_office) via signInWithPassword erhalten.`);

  // Lesen: darf NICHTS zurueckgeben (RLS blendet die Zeile aus, kein Fehler).
  const { data: readData, error: readError } = await client
    .from("reservations")
    .select("*")
    .eq("id", reservationBId);
  if (readError) {
    details.push(`RLS-Read: Fehler statt leerem Ergebnis (${readError.message}) — akzeptabel, solange keine Daten zurueckkommen.`);
  }
  const readBlocked = !readError && (readData ?? []).length === 0;
  if (!readBlocked) {
    allOk = false;
    details.push(`FEHLER: RLS-Read auf Hotel-B-Reservierung lieferte ${readData?.length ?? 0} Zeile(n) statt 0!`);
  } else {
    details.push(`RLS-Read: Hotel-B-Reservierung ueber Anon-Client (Hotel-A-Session) korrekt leer (0 Zeilen).`);
  }

  // Schreiben (Update): darf 0 Zeilen betreffen (RLS-USING filtert die Zeile
  // aus der sichtbaren Menge, kein Server-Fehler noetig).
  const { data: updateData, error: updateError } = await client
    .from("reservations")
    .update({ notes: "MANIPULIERT von Hotel-A-Session" })
    .eq("id", reservationBId)
    .select();
  const updateBlocked = !updateError ? (updateData ?? []).length === 0 : true;
  if (!updateBlocked) {
    allOk = false;
    details.push(`FEHLER: RLS-Update auf Hotel-B-Reservierung hat ${updateData?.length} Zeile(n) veraendert!`);
  } else {
    details.push(
      `RLS-Update: Hotel-B-Reservierung ueber Anon-Client (Hotel-A-Session) betraf 0 Zeilen (error=${updateError?.message ?? "keiner, aber 0 Treffer"}).`
    );
  }

  // Gegenprobe per Service-Role: Zeile wirklich unveraendert?
  const pool = rawPool();
  const { rows: verifyRows } = await pool.query<{ notes: string | null }>(
    `select notes from reservations where id = $1`,
    [reservationBId]
  );
  const notesUnchanged = verifyRows[0]?.notes !== "MANIPULIERT von Hotel-A-Session";
  if (!notesUnchanged) {
    allOk = false;
    details.push(`FEHLER: Reservierung wurde trotz RLS tatsaechlich veraendert (notes=${verifyRows[0]?.notes})!`);
  } else {
    details.push(`Gegenprobe per Service-Role: notes-Feld der Hotel-B-Reservierung unveraendert — Update war wirkungslos.`);
  }

  // Insert: neue Reservierung fuer Hotel B ueber Hotel-A-Session versuchen —
  // muss an der RLS-Policy scheitern (is_hotel_member(hotel_id) = false).
  const { error: insertError } = await client.from("reservations").insert({
    id: randomUUID(),
    hotel_id: fixtures.hotelB.id,
    reservation_no: `RES-HACK-${Date.now()}`,
    guest_id: fixtures.hotelB.guestId,
    room_type_id: fixtures.hotelB.roomTypeId,
    check_in_date: "2026-09-05",
    check_out_date: "2026-09-06",
  });
  if (!insertError) {
    allOk = false;
    details.push(`FEHLER: Insert einer neuen Hotel-B-Reservierung ueber Hotel-A-Session ist NICHT fehlgeschlagen!`);
  } else {
    details.push(`RLS-Insert: neue Hotel-B-Reservierung ueber Hotel-A-Session korrekt verweigert (${insertError.message}).`);
  }

  await client.auth.signOut();

  // --- (b) Modul-/RBAC-Ebene: ModuleContext von Hotel A, aber Hotel-B-IDs im Payload ---
  const crossTenantCtx: ModuleContext = {
    userId: fixtures.hotelA.frontOffice.id,
    hotelId: fixtures.hotelA.id,
    role: "front_office",
    requestId: randomUUID(),
    module: "pms",
  };

  let crossTenantRejected = false;
  let crossTenantErrorInfo = "";
  try {
    const leaked = await createReservation(crossTenantCtx, {
      guestId: fixtures.hotelB.guestId, // gehoert zu Hotel B, nicht zu ctx.hotelId!
      roomTypeId: fixtures.hotelB.roomTypeId, // ebenfalls Hotel B
      checkInDate: "2026-09-10",
      checkOutDate: "2026-09-12",
      adults: 1,
      children: 0,
      source: "direct",
    });
    crossTenantErrorInfo = `Kein Fehler geworfen — Reservierung ${leaked.id} wurde angelegt (hotel_id=${leaked.hotel_id}, guest_id=${leaked.guest_id})`;
  } catch (e) {
    crossTenantRejected = e instanceof NotFoundError || e instanceof ForbiddenError;
    crossTenantErrorInfo = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  }

  if (!crossTenantRejected) {
    allOk = false;
    details.push(
      `FEHLER: createReservation() mit Hotel-A-Kontext aber Hotel-B-guestId/roomTypeId im Payload wurde NICHT verweigert. ${crossTenantErrorInfo}`
    );
  } else {
    details.push(
      `Modul-Ebene: createReservation() mit Hotel-A-Kontext + Hotel-B-IDs im Payload korrekt verweigert (${crossTenantErrorInfo}). ` +
        `[Bugfix angewendet, siehe Bericht: modules/pms/reservations/service.ts prueft jetzt Hotel-Zugehoerigkeit von guestId/roomTypeId/roomId.]`
    );
  }

  // --- (b2) Reiner RBAC-Test: Rolle ohne passende Permission ---
  const noPermissionCtx: ModuleContext = {
    userId: fixtures.hotelA.frontOffice.id,
    hotelId: fixtures.hotelA.id,
    role: "housekeeping_staff", // hat kein pms.reservations.write
    requestId: randomUUID(),
    module: "pms",
  };
  let rbacRejected = false;
  let rbacInfo = "";
  try {
    await createReservation(noPermissionCtx, {
      guestId: fixtures.hotelA.guestId,
      roomTypeId: fixtures.hotelA.roomTypeId,
      checkInDate: "2026-09-15",
      checkOutDate: "2026-09-16",
      adults: 1,
      children: 0,
      source: "direct",
    });
    rbacInfo = "Kein Fehler geworfen!";
  } catch (e) {
    rbacRejected = e instanceof ForbiddenError;
    rbacInfo = e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e);
  }
  if (!rbacRejected) {
    allOk = false;
    details.push(`FEHLER: createReservation() mit Rolle 'housekeeping_staff' (keine pms.reservations.write-Permission) wurde NICHT verweigert. ${rbacInfo}`);
  } else {
    details.push(`RBAC: createReservation() mit Rolle 'housekeeping_staff' (fehlende Permission) korrekt per ForbiddenError verweigert (${rbacInfo}).`);
  }

  record(2, "Mandantentrennung (RLS + RBAC/Modul-Ebene)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "Mandantentrennung");
}
