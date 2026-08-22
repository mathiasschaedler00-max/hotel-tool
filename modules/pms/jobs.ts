import type { PgBoss } from "pg-boss";
import { withTransaction } from "@lib/db/pool";
import { QUEUES } from "@modules/_shared/topics";
import { createSystemContext } from "@modules/_shared/context";
import { writeAudit } from "@modules/audit/service";

interface NightAuditJobData {
  hotelId: string;
}

/**
 * Registriert die pg-boss-Handler des `pms`-Moduls. Wird von `worker/index.ts`
 * beim Boot aufgerufen (zusammen mit den `registerXJobs()`-Funktionen der
 * anderen Module).
 */
export async function registerPmsJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL);
  await boss.work<NightAuditJobData>(QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL, async ([job]) => {
    await runNightAuditNoOp(job.data.hotelId);
  });
}

/**
 * Platzhalter-Handler für `pms.night-audit.run-for-hotel`: schreibt nur einen
 * No-op-Audit-Eintrag ("gelaufen, no-op") — beweist Scheduling end-to-end
 * (Cron → Queue → Worker → DB), OHNE echte Nachtabrechnungs-Logik.
 *
 * TODO: Geschäftsregeln aus Teil A ergänzen (No-Show-Handling, automatische
 * Folio-Buchungen für die abgelaufene Nacht, Tagesabschluss-Reports).
 */
export async function runNightAuditNoOp(hotelId: string): Promise<void> {
  const ctx = createSystemContext(hotelId, "pms");
  await withTransaction(async (client) => {
    await writeAudit(client, ctx, {
      action: "pms.night_audit.no_op",
      resourceType: "hotel",
      resourceId: hotelId,
      after: { ranAt: new Date().toISOString(), status: "no_op" },
    });
  });
}
