import { z } from "zod";

export const createGuestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nationality: z.string().optional(),
  /** Reisepass-/Ausweisnummer — wird vor dem Insert feldverschlüsselt (siehe service.ts). */
  documentNumber: z.string().optional(),
});

export type CreateGuestInput = z.infer<typeof createGuestSchema>;

/** Volles Replace (nicht partial-patch) — gleiche Überlegung wie updateRoom(). */
export const updateGuestSchema = z.object({
  guestId: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  nationality: z.string().nullable(),
  /**
   * Ausweis-/Passnummer nachtragen (Meldedaten-Station beim Check-in,
   * Schritt 4). Bewusst KEIN Teil des Voll-Replace: `undefined` lässt eine
   * bereits gespeicherte Nummer unangetastet — sie kann mangels
   * Reveal-Flow gar nicht ausgelesen und damit auch nicht
   * zurückgeschrieben werden. Nur ein nicht-leerer String überschreibt.
   */
  documentNumber: z.string().min(1).optional(),
});

export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;
