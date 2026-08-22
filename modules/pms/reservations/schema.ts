import { z } from "zod";

// z.string().date() ist je nach zod-Major-Version unterschiedlich verfügbar
// (v4 kennt z.iso.date(), v3 nicht) — hier bewusst versionsunabhängig über
// eine einfache Regex gelöst statt sich auf eine bestimmte zod-API-Version
// zu verlassen.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Erwartetes Format: YYYY-MM-DD");

export const createReservationSchema = z
  .object({
    guestId: z.string().uuid(),
    roomTypeId: z.string().uuid(),
    roomId: z.string().uuid().optional(),
    groupBookingId: z.string().uuid().optional(),
    checkInDate: isoDate,
    checkOutDate: isoDate,
    adults: z.number().int().min(1).default(1),
    children: z.number().int().min(0).default(0),
    source: z.enum(["direct", "channel_manager", "phone", "walk_in"]).default("direct"),
    notes: z.string().optional(),
    /** Vorbelegung aus room_types.base_rate_cents × Nächte, hier überschreibbar (Auftrag Schritt 3). */
    rateCents: z.number().int().min(0).optional(),
  })
  .refine((v) => v.checkOutDate > v.checkInDate, {
    message: "checkOutDate muss nach checkInDate liegen",
    path: ["checkOutDate"],
  });

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const checkOutSchema = z.object({
  reservationId: z.string().uuid(),
});

export type CheckOutInput = z.infer<typeof checkOutSchema>;

/**
 * Ändert NUR Belegungsdaten (Personenzahl, Notiz, Preis-Override) — nicht
 * Zimmer/Zeitraum, dafür ist `moveReservation()` zuständig (eigene Funktion,
 * weil dort der Überbuchungsschutz greifen muss).
 */
export const updateReservationSchema = z.object({
  reservationId: z.string().uuid(),
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  notes: z.string().nullable(),
  rateCents: z.number().int().min(0),
});

export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;

/**
 * Verschiebt eine Reservierung (Zimmer und/oder Zeitraum). Beide Felder
 * optional — nur mitschicken, was sich ändert; die `no_double_booking`-
 * Constraint sichert gegen Überschneidungen ab (siehe service.ts).
 */
export const moveReservationSchema = z
  .object({
    reservationId: z.string().uuid(),
    roomId: z.string().uuid().nullable().optional(),
    checkInDate: isoDate.optional(),
    checkOutDate: isoDate.optional(),
  })
  .refine((v) => !(v.checkInDate && v.checkOutDate) || v.checkOutDate > v.checkInDate, {
    message: "checkOutDate muss nach checkInDate liegen",
    path: ["checkOutDate"],
  });

export type MoveReservationInput = z.infer<typeof moveReservationSchema>;

export const cancelReservationSchema = z.object({
  reservationId: z.string().uuid(),
  reason: z.string().min(1),
});

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;
