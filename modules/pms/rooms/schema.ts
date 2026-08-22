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

/**
 * Stammdaten (Screen 8 "Zimmerverwaltung") — bewusst OHNE Preis/max. Personen:
 * die liegen an der Kategorie (`room_types.base_rate_cents`/`capacity_*`),
 * nicht am einzelnen Zimmer. Ein Zimmer der Kategorie wechseln ändert damit
 * automatisch Preis/Belegung, ohne zwei Wahrheiten am selben Zimmer zu
 * pflegen (gleiche Überlegung wie bei Zimmer-Zustand vs. Buchungsstatus).
 */
export const createRoomSchema = z.object({
  roomNumber: z.string().min(1),
  floor: z.string().nullable().optional(),
  roomTypeId: z.string().uuid(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = z.object({
  roomId: z.string().uuid(),
  roomNumber: z.string().min(1),
  floor: z.string().nullable(),
  roomTypeId: z.string().uuid(),
});

export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
