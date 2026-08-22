import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { moveReservationSchema } from "@modules/pms/reservations/schema";
import { moveReservation } from "@modules/pms/reservations/service";

/** Zimmer und/oder Zeitraum ändern (z. B. Drag & Drop im Belegungsplan). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = moveReservationSchema.parse({ ...body, reservationId: id });
    const reservation = await moveReservation(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
