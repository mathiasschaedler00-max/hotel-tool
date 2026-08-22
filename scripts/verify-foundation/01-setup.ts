/**
 * Punkt 1 der Abnahme: zwei Hotels, je ein owner + front_office-Mitarbeiter.
 *
 * Fixtures (Hotels, hotel_members, room_types, rooms, hotel_modules) laufen
 * über den rohen pg-Pool (Service-Role-Ebene, RLS umgangen) — Vorgabe aus dem
 * Auftrag. Test-User laufen über `supabase.auth.admin.createUser` (Fake-
 * E-Mails, `email_confirm: true`, kein echter Mailversand).
 *
 * Die Gäste (guests) werden bewusst über die ECHTE `createGuest()`-Modul-
 * funktion angelegt (nicht per Fixture-SQL) — das übt die Feldverschlüsselung
 * der Ausweisnummer (AES-256-GCM, siehe modules/pms/guests/service.ts) gleich
 * mit einem echten Aufruf durch, statt sie ungetestet zu lassen.
 */
import { randomUUID } from "node:crypto";
import { rawPool, serviceClient, randomPassword, record } from "./_lib";
import { createGuest } from "@modules/pms/guests/service";
import type { ModuleContext } from "@modules/_shared/context";
import type { HotelRole } from "@modules/rbac/permissions";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: HotelRole;
}

export interface HotelFixture {
  id: string;
  slug: string;
  owner: TestUser;
  frontOffice: TestUser;
  roomTypeId: string;
  roomId: string;
  guestId: string;
}

export interface Fixtures {
  hotelA: HotelFixture;
  hotelB: HotelFixture;
}

async function createTestUser(email: string, role: HotelRole): Promise<TestUser> {
  const supabase = serviceClient();
  const password = randomPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`auth.admin.createUser(${email}) fehlgeschlagen: ${error.message}`);
  if (!data.user) throw new Error(`auth.admin.createUser(${email}) lieferte keinen User zurück`);
  return { id: data.user.id, email, password, role };
}

async function setupHotel(opts: {
  name: string;
  slug: string;
  ownerEmail: string;
  frontOfficeEmail: string;
}): Promise<HotelFixture> {
  const pool = rawPool();

  const owner = await createTestUser(opts.ownerEmail, "owner");
  const frontOffice = await createTestUser(opts.frontOfficeEmail, "front_office");

  const hotelId = randomUUID();
  await pool.query(`insert into hotels (id, name, slug, region, timezone) values ($1,$2,$3,'AT','Europe/Vienna')`, [
    hotelId,
    opts.name,
    opts.slug,
  ]);

  await pool.query(
    `insert into hotel_members (hotel_id, user_id, role) values ($1,$2,'owner'), ($1,$3,'front_office')`,
    [hotelId, owner.id, frontOffice.id]
  );

  // Alle drei Startmodule aktiv — Punkt 4 (Entitlement-Check) deaktiviert
  // `pms` für Hotel B gezielt später wieder.
  await pool.query(
    `insert into hotel_modules (hotel_id, module_key, enabled, enabled_at) values
       ($1,'pms',true,now()), ($1,'housekeeping',true,now()), ($1,'notifications',true,now())`,
    [hotelId]
  );

  const roomTypeId = randomUUID();
  await pool.query(
    `insert into room_types (id, hotel_id, name, code, capacity_adults, capacity_children, base_rate_cents)
     values ($1,$2,'Doppelzimmer Standard','DZ',2,1,9900)`,
    [roomTypeId, hotelId]
  );

  const roomId = randomUUID();
  await pool.query(
    `insert into rooms (id, hotel_id, room_type_id, room_number, floor, status) values ($1,$2,$3,'101','1','available')`,
    [roomId, hotelId, roomTypeId]
  );

  // Gast über die echte Modul-Funktion anlegen (übt Feldverschlüsselung mit).
  const ctx: ModuleContext = {
    userId: frontOffice.id,
    hotelId,
    role: "front_office",
    requestId: randomUUID(),
    module: "pms",
  };
  const guest = await createGuest(ctx, {
    firstName: "Test",
    lastName: `Gast ${opts.slug.toUpperCase()}`,
    email: `gast-${opts.slug}@test.hoteltool.local`,
    documentNumber: `P${Math.floor(Math.random() * 1_000_000)}`,
  });

  return {
    id: hotelId,
    slug: opts.slug,
    owner,
    frontOffice,
    roomTypeId,
    roomId,
    guestId: guest.id,
  };
}

export async function setupFixtures(): Promise<Fixtures> {
  const suffix = Date.now().toString(36);

  const hotelA = await setupHotel({
    name: `Testhotel A (${suffix})`,
    slug: `test-hotel-a-${suffix}`,
    ownerEmail: `owner-a-${suffix}@test.hoteltool.local`,
    frontOfficeEmail: `frontoffice-a-${suffix}@test.hoteltool.local`,
  });

  const hotelB = await setupHotel({
    name: `Testhotel B (${suffix})`,
    slug: `test-hotel-b-${suffix}`,
    ownerEmail: `owner-b-${suffix}@test.hoteltool.local`,
    frontOfficeEmail: `frontoffice-b-${suffix}@test.hoteltool.local`,
  });

  record(
    1,
    "Zwei Hotels anlegen (je owner + front_office)",
    "PASS",
    [
      `Hotel A: id=${hotelA.id} slug=${hotelA.slug}`,
      `  owner=${hotelA.owner.email} (${hotelA.owner.id})`,
      `  front_office=${hotelA.frontOffice.email} (${hotelA.frontOffice.id})`,
      `  room_type=${hotelA.roomTypeId} room=${hotelA.roomId} guest=${hotelA.guestId}`,
      `Hotel B: id=${hotelB.id} slug=${hotelB.slug}`,
      `  owner=${hotelB.owner.email} (${hotelB.owner.id})`,
      `  front_office=${hotelB.frontOffice.email} (${hotelB.frontOffice.id})`,
      `  room_type=${hotelB.roomTypeId} room=${hotelB.roomId} guest=${hotelB.guestId}`,
      `Alle 4 Users via supabase.auth.admin.createUser() angelegt (email_confirm=true, Fake-Domain .test.hoteltool.local).`,
      `Beide Hotels: Module pms/housekeeping/notifications aktiviert (hotel_modules.enabled=true).`,
    ].join("\n")
  );

  return { hotelA, hotelB };
}
