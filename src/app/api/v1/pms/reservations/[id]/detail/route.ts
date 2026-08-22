import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { getReservationHistory } from "@modules/pms/reservations/service";
import { getOpenBalanceForReservation } from "@modules/pms/folios/service";

/**
 * Erste GET-Route der App (siehe ARCHITECTURE.md-Lücke "keine einzige
 * GET-Route") — Verlauf + offener Saldo fürs Detail-Panel im Belegungsplan
 * (Schritt 2, nachträglich ergänzt). Bewusst ein Endpunkt statt zwei, da
 * das Panel beide Werte immer zusammen braucht.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const { id } = await params;
    const [history, openBalanceCents] = await Promise.all([
      getReservationHistory(ctx, id),
      getOpenBalanceForReservation(ctx, id),
    ]);
    return ok({ history, openBalanceCents });
  } catch (e) {
    return err(e);
  }
}
