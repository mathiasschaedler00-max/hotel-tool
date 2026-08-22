import { z } from "zod";

/**
 * Sechs Werte, bestätigt gegen docs/design/hotel-tool-design-referenz.md §3
 * (deckungsgleich mit dem Belegungsplan-Prototyp) — siehe Migration
 * `20260822200000_room_status_six_values.sql`.
 */
export const roomStatusValues = ["available", "reserved", "occupied", "cleaning", "maintenance", "blocked"] as const;

export const updateRoomStatusSchema = z.object({
  roomId: z.string().uuid(),
  status: z.enum(roomStatusValues),
});

export type UpdateRoomStatusInput = z.infer<typeof updateRoomStatusSchema>;
