import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { searchGuests } from "@modules/pms/guests/service";

/** `?q=` — Gastsuche fürs Buchungsformular (Auftrag Schritt 3). Leerer/zu kurzer Suchbegriff liefert bewusst eine leere Liste statt eines Fehlers. */
export async function GET(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return ok([]);
    const guests = await searchGuests(ctx, query);
    return ok(guests);
  } catch (e) {
    return err(e);
  }
}
