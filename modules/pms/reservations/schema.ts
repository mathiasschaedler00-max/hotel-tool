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

/**
 * Check-in (Schritt 4). `roomId` ist optional: ist der Reservierung schon ein
 * Zimmer zugewiesen, reicht die `reservationId`; sonst wird hier zugeteilt.
 *
 * `overrideRoomStatus` ist der bewusste Übersteuerungs-Fall aus der
 * Design-Referenz §5/Screen 3.3 ("Trotzdem zuweisen (geprüft)"): Das Zimmer
 * ist laut Housekeeping nicht frei, die Rezeption weiß es aber besser. Wird
 * er gesetzt, MUSS der Zimmerstatus mitkorrigiert werden — sonst laufen
 * Belegungsplan und Housekeeping dauerhaft auseinander (siehe Plan-Warnung
 * "Explizite Backend-Kopplung, leicht zu übersehen").
 */
export const checkInSchema = z.object({
  reservationId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  overrideRoomStatus: z.boolean().default(false),
  overrideReason: z.string().min(1).optional(),
});

export type CheckInInput = z.infer<typeof checkInSchema>;

/**
 * Zimmerzuteilung ohne Check-in (z. B. Vorbereitung am Vortag). Dieselbe
 * Housekeeping-Prüfung wie beim Check-in — ein Zimmer in Wartung/gesperrt
 * wird nur mit ausdrücklichem Override zugewiesen.
 */
export const assignRoomSchema = z.object({
  reservationId: z.string().uuid(),
  roomId: z.string().uuid(),
  overrideRoomStatus: z.boolean().default(false),
  overrideReason: z.string().min(1).optional(),
});

export type AssignRoomInput = z.infer<typeof assignRoomSchema>;

/**
 * `allowOpenBalance` ist der bewusste Override statt stillem Durchwinken
 * (Plan Schritt 4): steht bei der Abreise noch ein Saldo offen, blockiert
 * der Check-out — die Rezeption kann ihn mit Begründung trotzdem freigeben.
 */
export const checkOutSchema = z.object({
  reservationId: z.string().uuid(),
  allowOpenBalance: z.boolean().default(false),
  overrideReason: z.string().min(1).optional(),
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
