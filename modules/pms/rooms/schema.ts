import { z } from "zod";

export const updateRoomStatusSchema = z.object({
  roomId: z.string().uuid(),
  status: z.enum(["available", "occupied", "out_of_order"]),
});

export type UpdateRoomStatusInput = z.infer<typeof updateRoomStatusSchema>;
