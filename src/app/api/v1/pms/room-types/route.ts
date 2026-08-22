import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { createRoomTypeSchema } from "@modules/pms/room-types/schema";
import { createRoomType } from "@modules/pms/room-types/service";

export async function POST(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const body = createRoomTypeSchema.parse(await req.json());
    const roomType = await createRoomType(ctx, body);
    return ok(roomType, { status: 201 });
  } catch (e) {
    return err(e);
  }
}
