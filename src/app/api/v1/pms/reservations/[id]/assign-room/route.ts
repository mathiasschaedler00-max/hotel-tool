import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { assignRoomSchema } from "@modules/pms/reservations/schema";
import { assignRoom } from "@modules/pms/reservations/service";

/** Zimmerzuteilung ohne Check-in (z. B. Vorbereitung am Vortag), Schritt 4. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const input = assignRoomSchema.parse({ ...body, reservationId: id });
    const reservation = await assignRoom(ctx, input);
    return ok(reservation);
  } catch (e) {
    return err(e);
  }
}
