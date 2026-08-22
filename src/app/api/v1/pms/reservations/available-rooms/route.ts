import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { ValidationError } from "@modules/_shared/errors";
import { listAvailableRooms } from "@modules/pms/reservations/service";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** `?from=&to=&roomTypeId=` — freie Zimmer fürs Buchungsformular (Auftrag Schritt 3). */
export async function GET(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const url = new URL(req.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const roomTypeId = url.searchParams.get("roomTypeId") ?? undefined;
    if (!ISO_DATE_PATTERN.test(from) || !ISO_DATE_PATTERN.test(to)) {
      throw new ValidationError({ from, to }, "from/to müssen YYYY-MM-DD sein");
    }
    const rooms = await listAvailableRooms(ctx, from, to, roomTypeId);
    return ok(rooms);
  } catch (e) {
    return err(e);
  }
}
