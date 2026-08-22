/**
 * Phase 1, Schritt 2 — Verifikation des Cross-Tenant-Fixes in
 * `modules/pms/folios/service.ts#openFolio()` und
 * `modules/pms/payments/service.ts#recordPayment()`.
 *
 * Bug (vor diesem Fix): beide Funktionen haben ihre Fremdschlüssel
 * (`reservationId`/`guestId` bzw. `folioId`/`reservationId`) ungeprüft in
 * die Insert-Values übernommen — ein gültiger Hotel-A-Kontext konnte damit
 * eine tatsächlich zu Hotel B gehörende ID referenzieren (exakt dieselbe
 * Lücke, die im Phase-0-Abnahmetest für `reservations` gefunden und gefixt
 * wurde, siehe `scripts/verify-foundation/02-tenant-isolation.ts`).
 *
 * Testaufbau: zwei Testhotels (Muster aus `scripts/verify-foundation/01-setup.ts`,
 * hier wiederverwendet), je eine eigene Reservierung. Für jede der beiden
 * Funktionen: ein Angriffsversuch je Fremdschlüssel (muss `NotFoundError`
 * werfen) UND eine Positivkontrolle mit korrekten, zum eigenen Hotel
 * gehörenden IDs (muss durchgehen) — ohne die Positivkontrolle wäre ein
 * generischer Fehler (z. B. ein Tippfehler im SQL) nicht von einem
 * korrekten Reject zu unterscheiden.
 */
import { randomUUID } from "node:crypto";
import { record, assertTrue } from "./_lib";
import type { Fixtures, HotelFixture } from "../verify-foundation/01-setup";
import { createReservation } from "@modules/pms/reservations/service";
import { openFolio } from "@modules/pms/folios/service";
import { recordPayment } from "@modules/pms/payments/service";
import { NotFoundError } from "@modules/_shared/errors";
import type { ModuleContext } from "@modules/_shared/context";

function ownerCtx(hotel: HotelFixture): ModuleContext {
  return {
    userId: hotel.owner.id,
    hotelId: hotel.id,
    role: "owner",
    requestId: randomUUID(),
    module: "pms",
  };
}

async function createOwnReservation(hotel: HotelFixture, offsetDays: number) {
  const checkIn = new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + (offsetDays + 2) * 86_400_000).toISOString().slice(0, 10);
  return createReservation(ownerCtx(hotel), {
    guestId: hotel.guestId,
    roomTypeId: hotel.roomTypeId,
    roomId: hotel.roomId,
    checkInDate: checkIn,
    checkOutDate: checkOut,
    adults: 1,
    children: 0,
    source: "direct",
    notes: "Fixture fuer Cross-Tenant-Fix-Test (folios/payments)",
  });
}

export async function testCrossTenantFoliosPayments(fixtures: Fixtures): Promise<void> {
  const details: string[] = [];
  let allOk = true;

  function check(label: string, ok: boolean, info: string) {
    if (!ok) allOk = false;
    details.push(`${ok ? "OK" : "FEHLER"}: ${label} — ${info}`);
  }

  // Je eine echte, eigene Reservierung pro Hotel als Angriffsziel/Positiv-Fixture.
  const resA = await createOwnReservation(fixtures.hotelA, 40);
  const resB = await createOwnReservation(fixtures.hotelB, 41);
  details.push(`Fixture: Reservierung ${resA.id} in Hotel A, ${resB.id} in Hotel B angelegt.`);

  // ---- openFolio(): reservationId aus fremdem Hotel ----
  try {
    const leaked = await openFolio(ownerCtx(fixtures.hotelA), {
      reservationId: resB.id, // gehoert zu Hotel B!
      guestId: fixtures.hotelA.guestId,
    });
    check(
      "openFolio() mit Hotel-B-reservationId unter Hotel-A-Kontext",
      false,
      `NICHT verweigert — Folio ${leaked.id} wurde angelegt!`
    );
  } catch (e) {
    check(
      "openFolio() mit Hotel-B-reservationId unter Hotel-A-Kontext",
      e instanceof NotFoundError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  // ---- openFolio(): guestId aus fremdem Hotel ----
  try {
    const leaked = await openFolio(ownerCtx(fixtures.hotelA), {
      reservationId: resA.id,
      guestId: fixtures.hotelB.guestId, // gehoert zu Hotel B!
    });
    check(
      "openFolio() mit Hotel-B-guestId unter Hotel-A-Kontext",
      false,
      `NICHT verweigert — Folio ${leaked.id} wurde angelegt!`
    );
  } catch (e) {
    check(
      "openFolio() mit Hotel-B-guestId unter Hotel-A-Kontext",
      e instanceof NotFoundError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  // ---- openFolio(): Positivkontrolle (korrekte, eigene IDs muss durchgehen) ----
  let folioA: Awaited<ReturnType<typeof openFolio>> | undefined;
  try {
    folioA = await openFolio(ownerCtx(fixtures.hotelA), {
      reservationId: resA.id,
      guestId: fixtures.hotelA.guestId,
    });
    check("openFolio() Positivkontrolle (Hotel A, eigene IDs)", true, `Folio ${folioA.id} angelegt.`);
  } catch (e) {
    check(
      "openFolio() Positivkontrolle (Hotel A, eigene IDs)",
      false,
      `Haette durchgehen muessen, ist aber fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Legitimes Folio in Hotel B, als Angriffsziel fuer den Payments-Test.
  const folioB = await openFolio(ownerCtx(fixtures.hotelB), {
    reservationId: resB.id,
    guestId: fixtures.hotelB.guestId,
  });
  details.push(`Fixture: Folio ${folioB.id} in Hotel B angelegt (Angriffsziel fuer recordPayment()).`);

  // ---- recordPayment(): folioId aus fremdem Hotel ----
  try {
    const leaked = await recordPayment(ownerCtx(fixtures.hotelA), {
      folioId: folioB.id, // gehoert zu Hotel B!
      amountCents: 1000,
      method: "cash",
    });
    check(
      "recordPayment() mit Hotel-B-folioId unter Hotel-A-Kontext",
      false,
      `NICHT verweigert — Payment ${leaked.id} wurde angelegt!`
    );
  } catch (e) {
    check(
      "recordPayment() mit Hotel-B-folioId unter Hotel-A-Kontext",
      e instanceof NotFoundError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  // ---- recordPayment(): reservationId aus fremdem Hotel (kein folioId gesetzt) ----
  try {
    const leaked = await recordPayment(ownerCtx(fixtures.hotelA), {
      reservationId: resB.id, // gehoert zu Hotel B!
      amountCents: 1000,
      method: "cash",
    });
    check(
      "recordPayment() mit Hotel-B-reservationId unter Hotel-A-Kontext",
      false,
      `NICHT verweigert — Payment ${leaked.id} wurde angelegt!`
    );
  } catch (e) {
    check(
      "recordPayment() mit Hotel-B-reservationId unter Hotel-A-Kontext",
      e instanceof NotFoundError,
      e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)
    );
  }

  // ---- recordPayment(): Positivkontrolle ----
  if (folioA) {
    try {
      const payment = await recordPayment(ownerCtx(fixtures.hotelA), {
        folioId: folioA.id,
        amountCents: 5000,
        method: "cash",
      });
      check("recordPayment() Positivkontrolle (Hotel A, eigene folioId)", true, `Payment ${payment.id} angelegt.`);
    } catch (e) {
      check(
        "recordPayment() Positivkontrolle (Hotel A, eigene folioId)",
        false,
        `Haette durchgehen muessen, ist aber fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  record(
    1,
    "Phase 1, Schritt 2 — Cross-Tenant-Fix: openFolio()/recordPayment()",
    allOk ? "PASS" : "FAIL",
    details.join("\n")
  );
  assertTrue(allOk, "Cross-Tenant-Fix folios/payments");
}
