import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { cancelReservationSchema } from "@modules/pms/reservations/schema";
import { cancelReservation } from "@modules/pms/reservations/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = cancelReservationSchema.parse({ ...body, reservationId: id });
    const reservation = await cancelReservation(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
