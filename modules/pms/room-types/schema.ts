import { z } from "zod";

export const createRoomTypeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).nullable().optional(),
  capacityAdults: z.number().int().min(1).default(2),
  capacityChildren: z.number().int().min(0).default(0),
  baseRateCents: z.number().int().min(0).default(0),
  description: z.string().nullable().optional(),
});

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;

/**
 * Kategorien-Verwaltung (Auftrag 23.08.2026) — Basispreis/Nacht hier ist
 * bewusst nur die Basisrate. Saison-/Wochentagspreise und Ratenpläne kommen
 * erst mit dem Raten-Management (Schritt 3/V4), dynamische Anpassung erst
 * mit der Revenue-KI (Phase 5) — hier NICHT vorwegnehmen.
 */
export const updateRoomTypeSchema = z.object({
  roomTypeId: z.string().uuid(),
  name: z.string().min(1),
  code: z.string().min(1).nullable().optional(),
  capacityAdults: z.number().int().min(1),
  capacityChildren: z.number().int().min(0),
  baseRateCents: z.number().int().min(0),
  description: z.string().nullable().optional(),
});

export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>;
