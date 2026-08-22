#!/usr/bin/env npx tsx
/**
 * scripts/seed-demo.ts
 *
 * Erzeugt Demo-Daten für das bestehende Demo-Hotel: 3 Zimmerkategorien,
 * ~20 Zimmer, ein paar Demo-Gäste und Reservierungen über einen Zeitraum von
 * ±30 Tagen um heute, in gemischten Status (`confirmed`, `checked_in`,
 * `checked_out`, ein paar `cancelled`/`no_show`) — Datenquelle für den
 * Belegungsplan (Phase 1, Schritt 2), der mit den bisherigen 2 Zimmern/1
 * Buchung sonst nicht sinnvoll zu beurteilen wäre.
 *
 * NUR für die Dev-Datenbank gedacht — niemals gegen echte Kundendaten
 * ausführen. Die Namen/Buchungen sind offensichtlich fiktive Seed-Daten für
 * die Entwicklung (siehe CLAUDE.md "Keine erfundenen Inhalte" — das gilt für
 * die Anwendung selbst, nicht für Dev-Fixtures, wie schon in
 * `scripts/verify-foundation/01-setup.ts` üblich).
 *
 * Wiederholbar, aber pragmatisch gelöst statt perfekt idempotent:
 * - `room_types` werden über `code` (STD/KOM/SUI) dedupliziert.
 * - `rooms` werden über den vorhandenen `room_number`-Bestand dedupliziert
 *   (die DB hat ohnehin einen Unique-Index darauf).
 * - Gäste + Reservierungen: ein einziger Schwellenwert-Check auf die
 *   bestehende Reservierungsanzahl des Hotels — läuft die Seed-Routine
 *   schon einmal erfolgreich durch, überspringt ein zweiter Lauf sie
 *   komplett. Bei einem ABGEBROCHENEN Lauf (Prozess stirbt mitten in der
 *   Gäste-/Reservierungs-Schleife) ist ein erneuter Lauf NICHT dedupliziert
 *   (siehe `seedGuestsAndReservations()`) — für eine Demo-DB ein akzeptabler
 *   Kompromiss, aber bewusst dokumentiert.
 *
 * Aufruf: npx tsx scripts/seed-demo.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "node:crypto";
import { getPoolForReads } from "@lib/db/pool";
import { listRoomTypes, createRoomType, type RoomType } from "@modules/pms/room-types/service";
import { createGuest, type Guest } from "@modules/pms/guests/service";
import { createReservation } from "@modules/pms/reservations/service";
import type { ModuleContext } from "@modules/_shared/context";
import type { HotelRole } from "@modules/rbac/permissions";

// EIN Referenzzeitpunkt für den gesamten Lauf (kein verstreutes `new Date()`).
const REFERENCE_ISO = new Date().toISOString();
const TODAY = REFERENCE_ISO.slice(0, 10);

// Bekanntes Demo-Hotel (siehe Auftrag) — Fallback greift, falls diese ID in
// der jeweiligen Umgebung nicht existiert.
const KNOWN_DEMO_HOTEL_ID = "7c614a80-2b32-4dc1-9891-55ae195af974";

const RESERVATION_SEED_THRESHOLD = 20;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface RoomTypeDef {
  name: string;
  code: string;
  capacityAdults: number;
  capacityChildren: number;
  baseRateCents: number;
}

const ROOM_TYPE_DEFS: RoomTypeDef[] = [
  { name: "Standard", code: "STD", capacityAdults: 2, capacityChildren: 1, baseRateCents: 9_900 },
  { name: "Komfort", code: "KOM", capacityAdults: 2, capacityChildren: 2, baseRateCents: 14_900 },
  { name: "Suite", code: "SUI", capacityAdults: 4, capacityChildren: 2, baseRateCents: 24_900 },
];

interface RoomPlanEntry {
  code: string;
  floor: string;
  numbers: string[];
}

// Bewusst Zimmernummern ab Etage 2 (die bestehenden 101/102 aus früheren
// manuellen API-Tests bleiben unangetastet).
const ROOM_PLAN: RoomPlanEntry[] = [
  { code: "STD", floor: "2", numbers: ["201", "202", "203", "204", "205", "206", "207"] },
  { code: "KOM", floor: "3", numbers: ["301", "302", "303", "304", "305", "306", "307"] },
  { code: "SUI", floor: "4", numbers: ["401", "402", "403", "404", "405", "406"] },
];

const GUEST_NAME_DEFS: Array<{ firstName: string; lastName: string }> = [
  { firstName: "Anna", lastName: "Berger" },
  { firstName: "Lukas", lastName: "Fischer" },
  { firstName: "Sophie", lastName: "Wagner" },
  { firstName: "Maximilian", lastName: "Huber" },
  { firstName: "Laura", lastName: "Steiner" },
  { firstName: "Jonas", lastName: "Mayer" },
  { firstName: "Julia", lastName: "Gruber" },
  { firstName: "Felix", lastName: "Egger" },
  { firstName: "Marie", lastName: "Winkler" },
  { firstName: "David", lastName: "Moser" },
  { firstName: "Nina", lastName: "Brunner" },
  { firstName: "Paul", lastName: "Aigner" },
  { firstName: "Clara", lastName: "Lechner" },
  { firstName: "Tobias", lastName: "Frank" },
  { firstName: "Hannah", lastName: "Wolf" },
  { firstName: "Simon", lastName: "Krammer" },
];

// Buchungs-Schablonen als (Tage relativ zu heute, Nächte) — pro Zimmer um
// einen kleinen, konstanten Versatz verschoben, damit nicht alle Zimmer
// identisch aussehen. Der Versatz ist für ALLE Schablonen eines Zimmers
// gleich, daher bleiben die Abstände zwischen den Schablonen (>= 3 Tage
// Lücke, siehe Kommentar unten) erhalten — keine Überlappungen möglich.
const OFFSET_TEMPLATES: Array<{ offsetDays: number; nights: number }> = [
  { offsetDays: -27, nights: 2 },
  { offsetDays: -19, nights: 3 },
  { offsetDays: -11, nights: 2 },
  { offsetDays: -3, nights: 4 },
  { offsetDays: 4, nights: 3 },
  { offsetDays: 12, nights: 2 },
  { offsetDays: 20, nights: 4 },
];

type ReservationStatus = "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

function pickStatus(checkIn: string, checkOut: string, seq: number): ReservationStatus {
  if (checkOut <= TODAY) {
    if (seq % 9 === 0) return "no_show";
    if (seq % 13 === 0) return "cancelled";
    return "checked_out";
  }
  if (checkIn <= TODAY) {
    return "checked_in";
  }
  if (seq % 7 === 0) return "cancelled";
  return "confirmed";
}

async function findTargetHotel(pool: ReturnType<typeof getPoolForReads>): Promise<{ id: string; name: string }> {
  const fixed = await pool.query<{ id: string; name: string }>(
    `select id, name from hotels where id = $1 and deleted_at is null`,
    [KNOWN_DEMO_HOTEL_ID]
  );
  if (fixed.rows[0]) return fixed.rows[0];

  // Fallback: ältestes Hotel, das NICHT aus scripts/verify-foundation stammt
  // (dessen Test-Hotels heißen "test-hotel-a-*"/"test-hotel-b-*").
  const oldest = await pool.query<{ id: string; name: string }>(
    `select id, name from hotels
     where deleted_at is null and slug not like 'test-hotel-%'
     order by created_at asc limit 1`
  );
  if (!oldest.rows[0]) {
    throw new Error(
      "Kein geeignetes Hotel in der DB gefunden (weder die bekannte Demo-Hotel-ID noch ein Fallback) — Seed abgebrochen."
    );
  }
  return oldest.rows[0];
}

async function buildModuleContext(
  pool: ReturnType<typeof getPoolForReads>,
  hotelId: string
): Promise<ModuleContext> {
  const { rows } = await pool.query<{ user_id: string; role: string }>(
    `select user_id, role from hotel_members
     where hotel_id = $1 and deleted_at is null
     order by (role = 'owner') desc, created_at asc
     limit 1`,
    [hotelId]
  );
  const member = rows[0];
  if (!member) {
    throw new Error(
      `Hotel ${hotelId} hat kein Mitglied (hotel_members) — Seed braucht einen echten User (audit_log.actor_user_id verweist auf auth.users).`
    );
  }
  return {
    userId: member.user_id,
    hotelId,
    role: member.role as HotelRole,
    requestId: randomUUID(),
    module: "pms",
  };
}

async function ensureRoomTypes(ctx: ModuleContext): Promise<Map<string, RoomType>> {
  const existing = await listRoomTypes(ctx);
  const byCode = new Map(existing.filter((rt) => rt.code).map((rt) => [rt.code as string, rt]));

  const result = new Map<string, RoomType>();
  for (const def of ROOM_TYPE_DEFS) {
    const found = byCode.get(def.code);
    if (found) {
      result.set(def.code, found);
      continue;
    }
    const created = await createRoomType(ctx, def);
    console.log(`  Zimmerkategorie angelegt: ${created.name} (${created.code}, ${created.base_rate_cents / 100} EUR/Nacht)`);
    result.set(def.code, created);
  }
  return result;
}

interface SeedRoom {
  id: string;
  roomNumber: string;
  code: string;
}

async function ensureRooms(
  pool: ReturnType<typeof getPoolForReads>,
  hotelId: string,
  roomTypesByCode: Map<string, RoomType>
): Promise<SeedRoom[]> {
  const { rows: existingRooms } = await pool.query<{ id: string; room_number: string }>(
    `select id, room_number from rooms where hotel_id = $1 and deleted_at is null`,
    [hotelId]
  );
  const existingByNumber = new Map(existingRooms.map((r) => [r.room_number, r.id]));

  const result: SeedRoom[] = [];
  let createdCount = 0;
  for (const plan of ROOM_PLAN) {
    const roomType = roomTypesByCode.get(plan.code);
    if (!roomType) throw new Error(`Zimmerkategorie ${plan.code} fehlt — sollte vorher über ensureRoomTypes() angelegt worden sein.`);

    for (const number of plan.numbers) {
      const existingId = existingByNumber.get(number);
      if (existingId) {
        result.push({ id: existingId, roomNumber: number, code: plan.code });
        continue;
      }
      const id = randomUUID();
      await pool.query(
        `insert into rooms (id, hotel_id, room_type_id, room_number, floor, status)
         values ($1,$2,$3,$4,$5,'available')`,
        [id, hotelId, roomType.id, number, plan.floor]
      );
      result.push({ id, roomNumber: number, code: plan.code });
      createdCount++;
    }
  }
  console.log(`  ${createdCount} neue Zimmer angelegt (${result.length} insgesamt über die Seed-Kategorien).`);
  return result;
}

async function ensureGuests(ctx: ModuleContext, pool: ReturnType<typeof getPoolForReads>): Promise<Guest[]> {
  const { rows: existing } = await pool.query<{ id: string; first_name: string; last_name: string }>(
    `select id, first_name, last_name from guests where hotel_id = $1 and deleted_at is null order by created_at asc`,
    [ctx.hotelId]
  );

  if (existing.length >= GUEST_NAME_DEFS.length) {
    console.log(`  Bereits ${existing.length} Gäste vorhanden — Gäste-Seed übersprungen.`);
    return existing.map((g) => ({
      id: g.id,
      hotel_id: ctx.hotelId,
      first_name: g.first_name,
      last_name: g.last_name,
      email: null,
      phone: null,
      nationality: null,
      created_at: REFERENCE_ISO,
      updated_at: REFERENCE_ISO,
      deleted_at: null,
    }));
  }

  const guests: Guest[] = [...existing.map((g) => ({
    id: g.id,
    hotel_id: ctx.hotelId,
    first_name: g.first_name,
    last_name: g.last_name,
    email: null,
    phone: null,
    nationality: null,
    created_at: REFERENCE_ISO,
    updated_at: REFERENCE_ISO,
    deleted_at: null,
  }))];

  for (const def of GUEST_NAME_DEFS.slice(existing.length)) {
    const email = `${def.firstName}.${def.lastName}@demo.hoteltool.local`.toLowerCase();
    const guest = await createGuest(ctx, { firstName: def.firstName, lastName: def.lastName, email });
    guests.push(guest);
  }
  console.log(`  ${guests.length - existing.length} neue Demo-Gäste angelegt (insgesamt ${guests.length}).`);
  return guests;
}

async function seedReservations(
  ctx: ModuleContext,
  pool: ReturnType<typeof getPoolForReads>,
  rooms: SeedRoom[],
  roomTypesByCode: Map<string, RoomType>,
  guests: Guest[]
): Promise<void> {
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::int as n from reservations where hotel_id = $1 and deleted_at is null`,
    [ctx.hotelId]
  );
  const existingCount = Number(rows[0]?.n ?? 0);
  if (existingCount >= RESERVATION_SEED_THRESHOLD) {
    console.log(
      `  Bereits ${existingCount} Reservierungen vorhanden (Schwelle ${RESERVATION_SEED_THRESHOLD}) — Reservierungs-Seed übersprungen (nicht erneut für eine bereits geseedete Demo-DB ausführen).`
    );
    return;
  }

  let seq = 0;
  let created = 0;
  const sourceRotation: Array<"direct" | "channel_manager" | "phone" | "walk_in"> = [
    "direct",
    "channel_manager",
    "phone",
    "walk_in",
  ];

  for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
    const room = rooms[roomIndex];
    const roomType = roomTypesByCode.get(room.code);
    if (!roomType) continue;

    const staggerDays = roomIndex % 5; // 0-4 Tage Versatz pro Zimmer, siehe Kommentar oben

    for (const template of OFFSET_TEMPLATES) {
      const checkIn = addDays(TODAY, template.offsetDays + staggerDays);
      const checkOut = addDays(checkIn, template.nights);

      const guest = guests[seq % guests.length];
      const status = pickStatus(checkIn, checkOut, seq);

      const reservation = await createReservation(ctx, {
        guestId: guest.id,
        roomTypeId: roomType.id,
        roomId: room.id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: 1 + (seq % 2),
        children: seq % 3 === 0 ? 1 : 0,
        source: sourceRotation[seq % sourceRotation.length],
      });

      // Status + rate_cents sind für ein realistisches Demo-Bild gedacht.
      // WICHTIG: `createReservation()` selbst schreibt `rate_cents` nach wie
      // vor NICHT (das ist laut Plan explizit Schritt 3 — "rate_cents
      // reparieren" — vorbehalten, hier bewusst NICHT vorgezogen). Dieses
      // Backfill passiert nur hier im Seed-Skript per Direkt-SQL, nicht in
      // modules/pms/reservations/service.ts.
      const rateCents = roomType.base_rate_cents * template.nights;
      await pool.query(`update reservations set status = $2, rate_cents = $3 where id = $1`, [
        reservation.id,
        status,
        rateCents,
      ]);

      seq++;
      created++;
    }
  }
  console.log(`  ${created} Reservierungen angelegt (Zeitraum ${addDays(TODAY, -30)} bis ${addDays(TODAY, 30)}).`);
}

async function main(): Promise<void> {
  console.log(`Demo-Seed gestartet — Referenzdatum ${TODAY} (${REFERENCE_ISO}).\n`);

  const pool = getPoolForReads();

  const hotel = await findTargetHotel(pool);
  console.log(`Ziel-Hotel: ${hotel.name} (${hotel.id})`);

  const ctx = await buildModuleContext(pool, hotel.id);
  console.log(`Seed läuft als Hotel-Mitglied ${ctx.userId} (Rolle ${ctx.role}).\n`);

  console.log("Zimmerkategorien...");
  const roomTypesByCode = await ensureRoomTypes(ctx);

  console.log("Zimmer...");
  const rooms = await ensureRooms(pool, hotel.id, roomTypesByCode);

  console.log("Gäste...");
  const guests = await ensureGuests(ctx, pool);

  console.log("Reservierungen...");
  await seedReservations(ctx, pool, rooms, roomTypesByCode, guests);

  console.log("\nFertig.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Demo-Seed fehlgeschlagen:", e);
  process.exit(1);
});
