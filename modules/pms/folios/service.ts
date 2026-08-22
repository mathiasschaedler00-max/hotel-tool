import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
import { createServiceClient } from "@lib/supabase/service";
import type { OpenFolioInput } from "./schema";

export interface Folio {
  id: string;
  hotel_id: string;
  reservation_id: string;
  guest_id: string;
  status: "open" | "closed";
  prev_signature_hash: string | null;
  signature_hash: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

/** Read: einzelnes Folio. */
export async function getFolioById(ctx: Pick<ModuleContext, "hotelId">, id: string): Promise<Folio> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("folios")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("folio");
  return data as Folio;
}

/**
 * Write: Folio für eine Reservierung eröffnen.
 *
 * ⚠️ Cross-Tenant-Fix (Phase 1, Schritt 2): `reservationId`/`guestId` werden
 * jetzt VOR dem Insert gegen `ctx.hotelId` geprüft (siehe
 * `modules/_shared/tenant-guard.ts#assertBelongsToHotel()`) — vorher wurden
 * beide Fremdschlüssel ungeprüft übernommen, exakt dieselbe Lücke, die im
 * Phase-0-Abnahmetest für `reservations` gefunden und gefixt wurde.
 *
 * TODO: Geschäftsregeln aus Teil A ergänzen — RKSV-Signaturkette
 * (`prev_signature_hash` → `signature_hash`), Fiskal-Pflichtfelder,
 * Regeln für mehrere Folios pro Reservierung (z. B. Gruppenbuchungen).
 */
export async function openFolio(ctx: ModuleContext, input: OpenFolioInput): Promise<Folio> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.folios.write");

  const folioId = randomUUID();

  return executeWrite<Folio>(ctx, {
    resourceType: "folio",
    action: "folio.opened",
    mutate: async (client) => {
      await assertBelongsToHotel(client, ctx.hotelId, "reservations", input.reservationId, "reservation");
      await assertBelongsToHotel(client, ctx.hotelId, "guests", input.guestId, "guest");

      const { rows } = await client.query<Folio>(
        `insert into folios (id, hotel_id, reservation_id, guest_id, status)
         values ($1,$2,$3,$4,'open') returning *`,
        [folioId, ctx.hotelId, input.reservationId, input.guestId]
      );
      return { resourceId: folioId, after: rows[0] };
    },
  });
}
