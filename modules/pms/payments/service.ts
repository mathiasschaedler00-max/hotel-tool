import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
import { createServiceClient } from "@lib/supabase/service";
import type { RecordPaymentInput } from "./schema";

export interface Payment {
  id: string;
  hotel_id: string;
  folio_id: string | null;
  reservation_id: string | null;
  amount_cents: number;
  method: "cash" | "card" | "bank_transfer" | "online";
  status: "pending" | "completed" | "refunded" | "failed";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Read: alle Zahlungen zu einem Folio. */
export async function listPaymentsForFolio(ctx: Pick<ModuleContext, "hotelId">, folioId: string): Promise<Payment[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("payments")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .eq("folio_id", folioId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Payment[];
}

/**
 * Write: Zahlung erfassen.
 *
 * ⚠️ Cross-Tenant-Fix (Phase 1, Schritt 2): `folioId`/`reservationId` werden
 * jetzt — jeweils nur wenn gesetzt (beide sind optional, siehe
 * `recordPaymentSchema`) — VOR dem Insert gegen `ctx.hotelId` geprüft (siehe
 * `modules/_shared/tenant-guard.ts#assertBelongsToHotel()`) — vorher wurden
 * beide Fremdschlüssel ungeprüft übernommen, exakt dieselbe Lücke, die im
 * Phase-0-Abnahmetest für `reservations` gefunden und gefixt wurde.
 *
 * TODO: Geschäftsregeln aus Teil A ergänzen — Teilzahlungen, Rückerstattungs-
 * logik, Verknüpfung zu Fiskal-/Belegpflichten (RKSV).
 */
export async function recordPayment(ctx: ModuleContext, input: RecordPaymentInput): Promise<Payment> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.payments.write");

  const paymentId = randomUUID();

  return executeWrite<Payment>(ctx, {
    resourceType: "payment",
    action: "payment.recorded",
    mutate: async (client) => {
      if (input.folioId) {
        await assertBelongsToHotel(client, ctx.hotelId, "folios", input.folioId, "folio");
      }
      if (input.reservationId) {
        await assertBelongsToHotel(client, ctx.hotelId, "reservations", input.reservationId, "reservation");
      }

      const { rows } = await client.query<Payment>(
        `insert into payments (id, hotel_id, folio_id, reservation_id, amount_cents, method, status)
         values ($1,$2,$3,$4,$5,$6,'completed') returning *`,
        [paymentId, ctx.hotelId, input.folioId ?? null, input.reservationId ?? null, input.amountCents, input.method]
      );
      return { resourceId: paymentId, after: rows[0] };
    },
  });
}
