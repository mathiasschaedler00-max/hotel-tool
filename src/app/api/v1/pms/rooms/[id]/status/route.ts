import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { updateRoomStatusSchema } from "@modules/pms/rooms/schema";
import { updateRoomStatus } from "@modules/pms/rooms/service";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = updateRoomStatusSchema.parse({ roomId: id, status: body.status });
    const room = await updateRoomStatus(ctx, input);
    return ok(room);
  } catch (e) {
    return err(e);
  }
}
