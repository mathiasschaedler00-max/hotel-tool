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
