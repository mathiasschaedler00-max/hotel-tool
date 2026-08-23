import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError, ConflictError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import { EVENTS } from "@modules/_shared/topics";
import type { CreateRoomTypeInput, UpdateRoomTypeInput } from "./schema";

/** SQLSTATE 23505 = unique_violation — hier immer `idx_room_types_hotel_name` (Kategoriename schon vergeben). */
function isRoomTypeNameTaken(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "23505";
}

export interface RoomType {
  id: string;
  hotel_id: string;
  name: string;
  code: string | null;
  capacity_adults: number;
  capacity_children: number;
  base_rate_cents: number;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Read: alle aktiven Zimmerkategorien eines Hotels — Datenquelle für den
 * Kategorie-Filter im Belegungsplan (Phase 1, Schritt 2) und Voraussetzung
 * dafür, dass Reservierungen ohne manuelles SQL anlegbar sind.
 */
export async function listRoomTypes(ctx: Pick<ModuleContext, "hotelId">): Promise<RoomType[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("room_types")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoomType[];
}

/** Read: außer Betrieb genommene Kategorien — einzige Stelle, an der sie noch sichtbar sind (Voraussetzung für `reactivateRoomType()`). */
export async function listDeactivatedRoomTypes(ctx: Pick<ModuleContext, "hotelId">): Promise<RoomType[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("room_types")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .not("deleted_at", "is", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as RoomType[];
}

/**
 * Write: neue Zimmerkategorie anlegen.
 * `pms.room_types.write` ist nicht wörtlich in der Plan-Matrix gelistet
 * (siehe modules/rbac/permissions.ts), wird aber durch `general_manager`s
 * `"pms.*"` und `owner`s `"*"` bereits abgedeckt — gleiches Muster wie
 * `pms.hotels.write` in modules/pms/hotels/service.ts.
 */
export async function createRoomType(ctx: ModuleContext, input: CreateRoomTypeInput): Promise<RoomType> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.room_types.write");

  const roomTypeId = randomUUID();

  return executeWrite<RoomType>(ctx, {
    resourceType: "room_type",
    action: "room_type.created",
    mutate: async (client) => {
      let rows;
      try {
        ({ rows } = await client.query<RoomType>(
          `insert into room_types (id, hotel_id, name, code, capacity_adults, capacity_children, base_rate_cents, description)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           returning *`,
          [
            roomTypeId,
            ctx.hotelId,
            input.name,
            input.code ?? null,
            input.capacityAdults,
            input.capacityChildren,
            input.baseRateCents,
            input.description ?? null,
          ]
        ));
      } catch (e) {
        if (isRoomTypeNameTaken(e)) {
          throw new ConflictError(`Kategorie "${input.name}" existiert bereits`, { name: input.name });
        }
        throw e;
      }
      return { resourceId: roomTypeId, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_TYPE_CREATED, payload: { roomTypeId, name: input.name } },
  });
}

/**
 * Write: Stammdaten einer Kategorie ändern (Screen 8-Ergänzung
 * "Kategorien-Verwaltung", Auftrag 23.08.2026). `base_rate_cents` ist
 * bewusst nur die Basisrate — Saison-/Wochentagspreise (Raten-Management,
 * Schritt 3/V4) und dynamische Anpassung (Revenue-KI, Phase 5) kommen
 * später, hier nicht vorwegnehmen.
 */
export async function updateRoomType(ctx: ModuleContext, input: UpdateRoomTypeInput): Promise<RoomType> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.room_types.write");

  return executeWrite<RoomType>(ctx, {
    resourceType: "room_type",
    action: "room_type.updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<RoomType>(
        `select * from room_types where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.roomTypeId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room_type");

      let rows;
      try {
        ({ rows } = await client.query<RoomType>(
          `update room_types set
             name = $2, code = $3, capacity_adults = $4, capacity_children = $5,
             base_rate_cents = $6, description = $7
           where id = $1
           returning *`,
          [
            input.roomTypeId,
            input.name,
            input.code ?? null,
            input.capacityAdults,
            input.capacityChildren,
            input.baseRateCents,
            input.description ?? null,
          ]
        ));
      } catch (e) {
        if (isRoomTypeNameTaken(e)) {
          throw new ConflictError(`Kategorie "${input.name}" existiert bereits`, { name: input.name });
        }
        throw e;
      }
      return { resourceId: input.roomTypeId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_TYPE_UPDATED, payload: { roomTypeId: input.roomTypeId } },
  });
}

/**
 * Write: Kategorie deaktivieren (Auftrag 23.08.2026) — Soft-Delete wie
 * überall sonst, kein Hard-Delete. Schutz: eine Kategorie mit noch aktiv
 * zugeordneten Zimmern darf NICHT deaktiviert werden — `rooms.room_type_id`
 * ist `not null`, ein deaktiviertes Zimmer würde sonst auf eine
 * verschwundene Kategorie zeigen. Zimmer müssen erst umkategorisiert oder
 * selbst außer Betrieb genommen werden.
 */
export async function deactivateRoomType(ctx: ModuleContext, roomTypeId: string): Promise<RoomType> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.room_types.write");

  return executeWrite<RoomType>(ctx, {
    resourceType: "room_type",
    action: "room_type.deactivated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<RoomType>(
        `select * from room_types where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [roomTypeId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room_type");

      const { rows: countRows } = await client.query<{ count: string }>(
        `select count(*)::text as count from rooms where room_type_id = $1 and deleted_at is null`,
        [roomTypeId]
      );
      const roomCount = Number(countRows[0].count);
      if (roomCount > 0) {
        throw new ConflictError(
          `Kategorie hat noch ${roomCount} zugeordnete${roomCount === 1 ? "s" : ""} Zimmer — erst umkategorisieren oder außer Betrieb nehmen`,
          { roomCount }
        );
      }

      const { rows } = await client.query<RoomType>(
        `update room_types set deleted_at = now() where id = $1 returning *`,
        [roomTypeId]
      );
      return { resourceId: roomTypeId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_TYPE_DEACTIVATED, payload: { roomTypeId } },
  });
}

/** Write: Gegenstück zu `deactivateRoomType()` — macht die Kategorie wieder sichtbar/nutzbar. */
export async function reactivateRoomType(ctx: ModuleContext, roomTypeId: string): Promise<RoomType> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.room_types.write");

  return executeWrite<RoomType>(ctx, {
    resourceType: "room_type",
    action: "room_type.reactivated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<RoomType>(
        `select * from room_types where id = $1 and hotel_id = $2 and deleted_at is not null for update`,
        [roomTypeId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("room_type");

      let rows;
      try {
        ({ rows } = await client.query<RoomType>(
          `update room_types set deleted_at = null where id = $1 returning *`,
          [roomTypeId]
        ));
      } catch (e) {
        if (isRoomTypeNameTaken(e)) {
          throw new ConflictError(
            `Kategorie "${before.name}" existiert inzwischen wieder — erst umbenennen`,
            { name: before.name }
          );
        }
        throw e;
      }
      return { resourceId: roomTypeId, before, after: rows[0] };
    },
    event: { topic: EVENTS.ROOM_TYPE_REACTIVATED, payload: { roomTypeId } },
  });
}
