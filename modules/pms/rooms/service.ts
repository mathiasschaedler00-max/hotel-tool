import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { UpdateRoomStatusInput, roomStatusValues } from "./schema";

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
