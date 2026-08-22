import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { createGroupBookingSchema } from "@modules/pms/group-bookings/schema";
import { createGroupBooking } from "@modules/pms/group-bookings/service";

export async function POST(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const body = createGroupBookingSchema.parse(await req.json());
    const result = await createGroupBooking(ctx, body);
    return ok(result, { status: 201 });
  } catch (e) {
    return err(e);
  }
}
