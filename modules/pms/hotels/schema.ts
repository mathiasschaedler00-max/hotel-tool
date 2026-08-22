import { z } from "zod";

/**
 * Nicht Teil der Plan-Ordnerstruktur (die zeigt nur `hotels/service.ts`, ohne
 * `schema.ts`) — hier trotzdem ergänzt, für Konsistenz mit den übrigen
 * PMS-Submodulen (rooms/guests/reservations/folios/payments haben alle ein
 * `schema.ts`) und weil die Aufgabenbeschreibung explizit "jeweils schema.ts
 * + service.ts" für alle sechs Submodule verlangt.
 */
export const updateHotelSettingsSchema = z
  .object({
    name: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  })
  .refine((v) => v.name !== undefined || v.timezone !== undefined, {
    message: "Mindestens ein Feld (name oder timezone) muss angegeben werden",
  });

export type UpdateHotelSettingsInput = z.infer<typeof updateHotelSettingsSchema>;
