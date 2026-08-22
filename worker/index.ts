/**
 * Eigenständiger Node-Prozess für pg-boss (Queue + Event-Bus). Kein
 * Next.js/React im Runtime-Pfad — eigenes Deploy-Ziel (Fly.io/Railway/
 * Hetzner o. Ä. — Hosting-Entscheidung nicht Teil von Phase 0, siehe
 * ARCHITECTURE.md / docs/adr/0003).
 *
 * Nicht Teil des Plans, aber notwendig: `dotenv` lädt `.env.local`, da Next.js
 * das nur für seinen eigenen Prozess automatisch tut — dieser Prozess läuft
 * separat (`npm run worker`) und braucht sein eigenes Env-Loading.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { PgBoss } from "pg-boss";
import { getBoss } from "@lib/queue/boss";
import { QUEUES } from "@modules/_shared/topics";
import { createServiceClient } from "@lib/supabase/service";
import { registerPmsJobs } from "@modules/pms/jobs";
import { registerHousekeepingTaskJobs } from "@modules/housekeeping/tasks/jobs";
import { registerNotificationsJobs } from "@modules/notifications/jobs";

// Annahme — Teil A prüfen: genauer Zeitpunkt des Night Audits.
// 04:00 Europe/Vienna ist ein plausibler Standardwert für Hotelbetrieb.
const NIGHT_AUDIT_CRON = "0 4 * * *";

/**
 * Ein `boss.schedule()`-Eintrag PRO Hotel (per `key: hotel.id` unterscheidbar,
 * siehe Architekturplan: "Scheduled (cron pro Hotel, Europe/Vienna)"). Läuft
 * beim Worker-Boot; findet der Service-Client keine Hotels (z. B. weil noch
 * kein echtes Supabase-Projekt existiert, siehe ARCHITECTURE.md), wird das
 * nur geloggt — der Worker startet trotzdem.
 */
async function scheduleNightAuditForAllHotels(boss: PgBoss): Promise<void> {
  const service = createServiceClient();
  const { data: hotels, error } = await service.from("hotels").select("id").is("deleted_at", null);

  if (error) {
    console.error("[worker] konnte Hotels für Night-Audit-Scheduling nicht laden:", error.message);
    return;
  }

  for (const hotel of hotels ?? []) {
    await boss.schedule(
      QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL,
      NIGHT_AUDIT_CRON,
      { hotelId: hotel.id as string },
      { tz: "Europe/Vienna", key: hotel.id as string }
    );
  }
  console.info(`[worker] Night-Audit für ${hotels?.length ?? 0} Hotel(s) geplant (${NIGHT_AUDIT_CRON}, Europe/Vienna).`);
}

async function main(): Promise<void> {
  const boss = await getBoss();

  await registerPmsJobs(boss);
  await registerHousekeepingTaskJobs(boss);
  await registerNotificationsJobs(boss);

  await scheduleNightAuditForAllHotels(boss);

  console.info("[worker] pg-boss gestartet, alle Handler registriert.");

  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal} empfangen, fahre pg-boss herunter…`);
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] Fataler Fehler beim Start", err);
  process.exit(1);
});
