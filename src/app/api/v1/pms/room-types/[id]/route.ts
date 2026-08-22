import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { updateRoomTypeSchema } from "@modules/pms/room-types/schema";
import { updateRoomType } from "@modules/pms/room-types/service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = updateRoomTypeSchema.parse({ ...body, roomTypeId: id });
    const roomType = await updateRoomType(ctx, input);
    return ok(roomType);
  } catch (e) {
    return err(e);
  }
}
