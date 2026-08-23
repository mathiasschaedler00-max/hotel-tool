import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { reactivateRoomType } from "@modules/pms/room-types/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const roomType = await reactivateRoomType(ctx, id);
    return ok(roomType);
  } catch (e) {
    return err(e);
  }
}
