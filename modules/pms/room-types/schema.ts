import { z } from "zod";

export const createRoomTypeSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1).optional(),
  capacityAdults: z.number().int().min(1).default(2),
  capacityChildren: z.number().int().min(0).default(0),
  baseRateCents: z.number().int().min(0).default(0),
});

export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>;
