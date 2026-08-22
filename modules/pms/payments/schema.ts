import { z } from "zod";

export const recordPaymentSchema = z
  .object({
    folioId: z.string().uuid().optional(),
    reservationId: z.string().uuid().optional(),
    amountCents: z.number().int().positive(),
    method: z.enum(["cash", "card", "bank_transfer", "online"]),
  })
  .refine((v) => v.folioId !== undefined || v.reservationId !== undefined, {
    message: "folioId oder reservationId erforderlich",
  });

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
