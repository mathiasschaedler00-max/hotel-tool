import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { createRoomSchema } from "@modules/pms/rooms/schema";
import { createRoom } from "@modules/pms/rooms/service";

/** Dünner Handler nach demselben Muster wie guests/route.ts. */
export async function POST(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const body = createRoomSchema.parse(await req.json());
    const room = await createRoom(ctx, body);
    return ok(room, { status: 201 });
  } catch (e) {
    return err(e);
  }
}
