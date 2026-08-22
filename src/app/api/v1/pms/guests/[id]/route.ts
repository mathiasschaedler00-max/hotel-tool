import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { updateGuestSchema } from "@modules/pms/guests/schema";
import { updateGuest } from "@modules/pms/guests/service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = updateGuestSchema.parse({ ...body, guestId: id });
    const guest = await updateGuest(ctx, input);
    return ok(guest);
  } catch (e) {
    return err(e);
  }
}
