import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { updateRoomSchema } from "@modules/pms/rooms/schema";
import { updateRoom } from "@modules/pms/rooms/service";

/** Stammdaten (Nummer/Etage/Kategorie) — Zimmer-Zustand bleibt bei status/route.ts. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const body = await req.json();
    const input = updateRoomSchema.parse({ ...body, roomId: id });
    const room = await updateRoom(ctx, input);
    return ok(room);
  } catch (e) {
    return err(e);
  }
}
