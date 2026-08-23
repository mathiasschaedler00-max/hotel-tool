import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { checkOutSchema } from "@modules/pms/reservations/schema";
import { checkOut } from "@modules/pms/reservations/service";

/**
 * Checkout-Endpunkt (Verifikations-Abnahmepunkt 5 aus dem Architekturplan):
 * publiziert intern `booking.checked_out`, worauf der Worker eine
 * Housekeeping-Aufgabe erzeugt (`modules/housekeeping/tasks/jobs.ts`).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    // Body ist optional — der Verifikations-Abnahmepunkt ruft ohne auf, die
    // Oberfläche schickt `allowOpenBalance`/`overrideReason` mit.
    const body = await req.json().catch(() => ({}));
    const input = checkOutSchema.parse({ ...body, reservationId: id });
    const reservation = await checkOut(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
