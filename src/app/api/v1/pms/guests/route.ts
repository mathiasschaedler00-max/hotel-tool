import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { createGuestSchema } from "@modules/pms/guests/schema";
import { createGuest } from "@modules/pms/guests/service";

/** Dünner Handler nach demselben Muster wie reservations/route.ts. */
export async function POST(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const body = createGuestSchema.parse(await req.json());
    const guest = await createGuest(ctx, body);
    return ok(guest, { status: 201 });
  } catch (e) {
    return err(e);
  }
}
