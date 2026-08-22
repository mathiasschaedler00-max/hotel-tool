import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { updateReservationSchema } from "@modules/pms/reservations/schema";
import { updateReservation } from "@modules/pms/reservations/service";

/** Belegungsdaten (Personenzahl/Notiz/Preis) — nicht Zimmer/Zeitraum, dafür ist [id]/move zuständig. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = updateReservationSchema.parse({ ...body, reservationId: id });
    const reservation = await updateReservation(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
