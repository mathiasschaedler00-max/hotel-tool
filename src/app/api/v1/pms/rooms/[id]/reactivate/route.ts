import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { reactivateRoom } from "@modules/pms/rooms/service";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const room = await reactivateRoom(ctx, id);
    return ok(room);
  } catch (e) {
    return err(e);
  }
}
