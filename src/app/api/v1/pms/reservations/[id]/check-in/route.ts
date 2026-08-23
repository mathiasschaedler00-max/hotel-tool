import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { checkInSchema } from "@modules/pms/reservations/schema";
import { checkIn } from "@modules/pms/reservations/service";

/**
 * Check-in (Schritt 4). Antwortet mit 409 + `details.requiresOverride`, wenn
 * das Zimmer laut Housekeeping nicht bezugsfertig ist — die Oberfläche zeigt
 * daraufhin die bewusste Übersteuerung an, statt still durchzuwinken.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = checkInSchema.parse({ ...body, reservationId: id });
    const reservation = await checkIn(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
