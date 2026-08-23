import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
import { EVENTS } from "@modules/_shared/topics";
import { createServiceClient } from "@lib/supabase/service";
import type { CreateRoomInput, UpdateRoomInput, UpdateRoomStatusInput, roomStatusValues } from "./schema";

export interface Room {
  id: string;
  hotel_id: string;
  room_type_id: string;
  room_number: string;
  floor: string | null;
  status: (typeof roomStatusValues)[number];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Read: alle aktiven Zimmer eines Hotels. */
export async function listRooms(ctx: Pick<ModuleContext, "hotelId">): Promise<Room[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("rooms")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .is("deleted_at", null)
    .order("room_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Room[];
}

/** Read: außer Betrieb genommene Zimmer — einzige Stelle, an der sie noch sichtbar sind (Voraussetzung für `reactivateRoom()`). */
export async function listDeactivatedRooms(ctx: Pick<ModuleContext, "hotelId">): Promise<Room[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("rooms")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .not("deleted_at", "is", null)
    .order("room_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Room[];
}

/**
 * Write: Zimmerstatus ändern (z. B. "out_of_order" bei einem Wartungsfall).
 * TODO: Geschäftsregeln aus Teil A ergänzen (z. B. darf ein Zimmer mit aktiver
 * Reservierung überhaupt out_of_order gesetzt werden, Verknüpfung zu
 * housekeeping-Tasks bei Statuswechsel).
 */
export async function updateRoomStatus(ctx: ModuleContext, input: UpdateRoomStatusInput): Promise<Room> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.rooms.write");

  return executeWrite<Room>(ctx, {
    resourceType: "room",
    action: "room.status_updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Room>(
        `select * from rooms where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.roomId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room");

      const { rows } = await client.query<Room>(`update rooms set status = $2 where id = $1 returning *`, [
        input.roomId,
        input.status,
      ]);
      return { resourceId: input.roomId, before, after: rows[0] };
    },
  });
}

/**
 * Write: neues Zimmer anlegen (Screen 8 "Zimmerverwaltung"). Preis/max.
 * Personen werden bewusst nicht hier gesetzt — die liegen an der Kategorie
 * (`room_type_id`), siehe Kommentar in `schema.ts`. Status startet immer bei
 * `available` (ein neu angelegtes Zimmer ist frei, nicht in Reinigung/Wartung).
 */
export async function createRoom(ctx: ModuleContext, input: CreateRoomInput): Promise<Room> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.rooms.write");

  const roomId = randomUUID();

  return executeWrite<Room>(ctx, {
    resourceType: "room",
    action: "room.created",
    mutate: async (client) => {
      await assertBelongsToHotel(client, ctx.hotelId, "room_types", input.roomTypeId, "room_type");

      const { rows } = await client.query<Room>(
        `insert into rooms (id, hotel_id, room_type_id, room_number, floor)
         values ($1, $2, $3, $4, $5)
         returning *`,
        [roomId, ctx.hotelId, input.roomTypeId, input.roomNumber, input.floor ?? null]
      );
      return { resourceId: roomId, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_CREATED, payload: { roomId, roomNumber: input.roomNumber } },
  });
}

/**
 * Write: Stammdaten ändern (Nummer, Etage, Kategorie) — NICHT den
 * Zimmer-Zustand, dafür bleibt `updateRoomStatus()` zuständig (eigener
 * Endpunkt, eigene Bedeutung, siehe §3.1 in der Design-Referenz).
 */
export async function updateRoom(ctx: ModuleContext, input: UpdateRoomInput): Promise<Room> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.rooms.write");

  return executeWrite<Room>(ctx, {
    resourceType: "room",
    action: "room.updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Room>(
        `select * from rooms where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.roomId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room");

      await assertBelongsToHotel(client, ctx.hotelId, "room_types", input.roomTypeId, "room_type");

      const { rows } = await client.query<Room>(
        `update rooms set room_number = $2, floor = $3, room_type_id = $4 where id = $1 returning *`,
        [input.roomId, input.roomNumber, input.floor, input.roomTypeId]
      );
      return { resourceId: input.roomId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_UPDATED, payload: { roomId: input.roomId } },
  });
}

/**
 * Write: Zimmer außer Betrieb nehmen (Soft-Delete über `deleted_at`, nie
 * hart löschen — Historie/Auswertungen brauchen die Zeile weiterhin,
 * insbesondere fiskalisch). Verschwindet dadurch automatisch aus
 * `listRooms()` und damit aus Belegungsplan + Buchbarkeit, ohne dass eine
 * zweite Stelle das Filtern extra nachbauen müsste.
 */
export async function deactivateRoom(ctx: ModuleContext, roomId: string): Promise<Room> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.rooms.write");

  return executeWrite<Room>(ctx, {
    resourceType: "room",
    action: "room.deactivated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Room>(
        `select * from rooms where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [roomId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room");

      const { rows } = await client.query<Room>(`update rooms set deleted_at = now() where id = $1 returning *`, [
        roomId,
      ]);
      return { resourceId: roomId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_DEACTIVATED, payload: { roomId } },
  });
}

/** Write: Gegenstück zu `deactivateRoom()` — macht das Zimmer wieder sichtbar/buchbar. */
export async function reactivateRoom(ctx: ModuleContext, roomId: string): Promise<Room> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.rooms.write");

  return executeWrite<Room>(ctx, {
    resourceType: "room",
    action: "room.reactivated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Room>(
        `select * from rooms where id = $1 and hotel_id = $2 and deleted_at is not null for update`,
        [roomId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room");

      const { rows } = await client.query<Room>(`update rooms set deleted_at = null where id = $1 returning *`, [
        roomId,
      ]);
      return { resourceId: roomId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_REACTIVATED, payload: { roomId } },
  });
}
