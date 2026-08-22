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
