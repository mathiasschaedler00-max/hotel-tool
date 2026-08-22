import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Erwartetes Format: YYYY-MM-DD");

const groupReservationInput = z.object({
  guestId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  checkInDate: isoDate,
  checkOutDate: isoDate,
  adults: z.number().int().min(1).default(1),
  children: z.number().int().min(0).default(0),
  notes: z.string().optional(),
  rateCents: z.number().int().min(0).optional(),
});

export const createGroupBookingSchema = z.object({
  name: z.string().min(1),
  contactGuestId: z.string().uuid().optional(),
  checkInDate: isoDate.optional(),
  checkOutDate: isoDate.optional(),
  reservations: z.array(groupReservationInput).min(1),
});

export type CreateGroupBookingInput = z.infer<typeof createGroupBookingSchema>;
