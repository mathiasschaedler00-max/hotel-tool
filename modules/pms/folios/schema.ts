import { z } from "zod";

export const openFolioSchema = z.object({
  reservationId: z.string().uuid(),
  guestId: z.string().uuid(),
});

export type OpenFolioInput = z.infer<typeof openFolioSchema>;
