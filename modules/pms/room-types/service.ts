import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { CreateRoomTypeInput } from "./schema";

export interface RoomType {
  id: string;
  hotel_id: string;
  name: string;
  code: string | null;
  capacity_adults: number;
  capacity_children: number;
  base_rate_cents: number;
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
      const { rows } = await client.query<RoomType>(
        `insert into room_types (id, hotel_id, name, code, capacity_adults, capacity_children, base_rate_cents)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning *`,
        [
          roomTypeId,
          ctx.hotelId,
          input.name,
          input.code ?? null,
          input.capacityAdults,
          input.capacityChildren,
          input.baseRateCents,
        ]
      );
      return { resourceId: roomTypeId, after: rows[0] };
    },
  });
}
