import { z } from "zod";

/**
 * Vier echte Zimmer-/Housekeeping-Zustände (Korrektur nach Review, siehe
 * Migration `20260822210000_room_status_only_housekeeping_states.sql`).
 * "Reserviert"/"Belegt" sind bewusst KEIN Zimmerstatus mehr — die werden aus
 * `reservations.status` abgeleitet und im Belegungsplan über die
 * Buchungsbalken dargestellt (siehe `reservation-status.ts`), nicht mehr
 * hier manuell am Zimmer setzbar.
 */
export const roomStatusValues = ["available", "cleaning", "maintenance", "blocked"] as const;

export const updateRoomStatusSchema = z.object({
  roomId: z.string().uuid(),
  status: z.enum(roomStatusValues),
});

export type UpdateRoomStatusInput = z.infer<typeof updateRoomStatusSchema>;
