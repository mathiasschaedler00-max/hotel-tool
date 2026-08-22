import { getModuleContext } from "@modules/_shared/context";
import { ok, err } from "@modules/_shared/response";
import { createReservationSchema } from "@modules/pms/reservations/schema";
import { createReservation } from "@modules/pms/reservations/service";

/**
 * Dünner Handler nach Plan-Muster: parse → zod → modules/pms/... → envelope.
 * GESAMTE Geschäftslogik lebt in `modules/pms/reservations/service.ts`
 * (Vorgabe #1) — hier passiert nur Auth/Kontext-Aufbau, Validierung und die
 * Übersetzung von Erfolg/Fehler in die HTTP-Antwort.
 *
 * Abweichung vom Plan-Codebeispiel: dort liegt `schema.parse(...)` AUSSERHALB
 * des try/catch — ein ZodError würde dann nie `err()` erreichen und stattdessen
 * als unbehandelte Exception durchschlagen (widerspricht "ValidationError→400"
 * aus demselben Plan-Abschnitt). Hier deshalb bewusst alles in einem
 * try/catch, `err()` behandelt zusätzlich `ZodError` (siehe response.ts).
 */
export async function POST(req: Request) {
  try {
    const ctx = await getModuleContext(req, "pms");
    const body = createReservationSchema.parse(await req.json());
    const reservation = await createReservation(ctx, body);
    return ok(reservation, { status: 201 });
  } catch (e) {
    return err(e);
  }
}
