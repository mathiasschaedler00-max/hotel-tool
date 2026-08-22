import { z } from "zod";

export const updateTaskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]),
});

export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
