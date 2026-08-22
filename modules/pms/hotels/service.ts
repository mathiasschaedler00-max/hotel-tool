import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { UpdateHotelSettingsInput } from "./schema";

export interface Hotel {
  id: string;
  name: string;
  slug: string;
  region: string;
  timezone: string;
  created_at: string;
  deleted_at: string | null;
}

/**
 * Read: Stammdaten des Hotels. Kein `assertModuleEnabled()` — die
 * Hotel-Stammdaten selbst gehören zum Multi-Tenant-Kern (Stage 1), nicht zu
 * einem abschaltbaren Fachmodul; jedes aktive Hotel-Mitglied darf sie sehen.
 */
export async function getHotelById(hotelId: string): Promise<Hotel> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("hotels")
    .select("*")
    .eq("id", hotelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("hotel");
  return data as Hotel;
}

/**
 * Write: Name/Zeitzone ändern. `pms.hotels.write` ist nicht wörtlich in der
 * Plan-Matrix gelistet, wird aber durch `general_manager`s `"pms.*"` und
 * `owner`s `"*"` bereits abgedeckt (siehe modules/rbac/permissions.ts).
 * TODO: Geschäftsregeln aus Teil A ergänzen (z. B. wer darf `slug` ändern,
 * Pflichtfelder für Fiskal-/Rechnungsadresse).
 */
export async function updateHotelSettings(ctx: ModuleContext, input: UpdateHotelSettingsInput): Promise<Hotel> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.hotels.write");

  return executeWrite<Hotel>(ctx, {
    resourceType: "hotel",
    action: "hotel.settings_updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Hotel>(`select * from hotels where id = $1 for update`, [
        ctx.hotelId,
      ]);
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("hotel");

      const { rows } = await client.query<Hotel>(
        `update hotels set name = coalesce($2, name), timezone = coalesce($3, timezone) where id = $1 returning *`,
        [ctx.hotelId, input.name ?? null, input.timezone ?? null]
      );
      return { resourceId: ctx.hotelId, before, after: rows[0] };
    },
  });
}
