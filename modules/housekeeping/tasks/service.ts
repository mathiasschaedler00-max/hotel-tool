import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { UpdateTaskStatusInput } from "./schema";

export interface Task {
  id: string;
  hotel_id: string;
  related_type: string;
  related_id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  source: "manual" | "system" | "ai";
  ai_decision_id: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

/** Read: offene/laufende Aufgaben eines Hotels (z. B. für ein künftiges Housekeeping-Board). */
export async function listOpenTasks(ctx: Pick<ModuleContext, "hotelId">): Promise<Task[]> {
  await assertModuleEnabled(ctx.hotelId, "housekeeping");

  const service = createServiceClient();
  const { data, error } = await service
    .from("tasks")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Task[];
}

/**
 * Write: Aufgabenstatus ändern (z. B. Zimmermädchen markiert "erledigt").
 * TODO: Geschäftsregeln aus Teil A ergänzen (Eskalationsregeln bei
 * überfälligen Aufgaben, wer darf welche Statuswechsel durchführen).
 */
export async function updateTaskStatus(ctx: ModuleContext, input: UpdateTaskStatusInput): Promise<Task> {
  await assertModuleEnabled(ctx.hotelId, "housekeeping");
  requirePermission(ctx, "housekeeping.tasks.update");

  return executeWrite<Task>(ctx, {
    resourceType: "task",
    action: "task.status_updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Task>(
        `select * from tasks where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.taskId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("task");

      const { rows } = await client.query<Task>(
        `update tasks
         set status = $2, completed_at = case when $2 = 'done' then now() else completed_at end
         where id = $1
         returning *`,
        [input.taskId, input.status]
      );
      return { resourceId: input.taskId, before, after: rows[0] };
    },
  });
}
