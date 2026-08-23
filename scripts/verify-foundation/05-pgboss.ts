/**
 * Punkt 5 der Abnahme: pg-boss real (Event-Bus + Scheduled Jobs).
 *
 * - Startet `worker/index.ts` als echten Hintergrundprozess (`npx tsx`).
 * - Checkt eine Hotel-A-Reservierung ein (Fixture-Update, absichtlich per
 *   SQL statt eines fehlenden `checkIn()`-Service — siehe Bericht) und ruft
 *   dann die ECHTE `checkOut()`-Funktion auf.
 * - Prueft: Topic `booking.checked_out` publiziert (`events`-Tabelle),
 *   Worker hat es verarbeitet (`tasks`-Zeile fuer Housekeeping entstanden).
 * - Triggert den `night-audit`-Job manuell fuer beide Hotels (`boss.send`)
 *   und prueft zusaetzlich, dass `pgboss.schedule` fuer beide Hotels
 *   registriert ist (Cron-Scheduling beim Worker-Boot).
 * - Faehrt den Worker-Prozess am Ende wieder herunter.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { rawPool, record, assertTrue, pollUntil } from "./_lib";
import type { Fixtures } from "./01-setup";
import type { WritePathResult } from "./03-write-path";
import { checkOut } from "@modules/pms/reservations/service";
import { sendJob } from "@lib/queue/boss";
import { QUEUES } from "@modules/_shared/topics";
import type { ModuleContext } from "@modules/_shared/context";

function startWorker(): Promise<{ proc: ChildProcessByStdio<null, Readable, Readable>; log: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["tsx", "worker/index.ts"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log: string[] = [];
    let settled = false;

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      log.push(text);
      if (!settled && text.includes("[worker] pg-boss gestartet")) {
        settled = true;
        resolve({ proc, log });
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Worker-Prozess beendete sich vorzeitig (code=${code}). Log:\n${log.join("")}`));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timeout: Worker hat sich nicht innerhalb von 20s gemeldet. Log bisher:\n${log.join("")}`));
      }
    }, 20_000);
  });
}

async function stopWorker(proc: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 5000);
  });
}

export async function testPgBoss(fixtures: Fixtures, writePath: WritePathResult): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  const pool = rawPool();

  const { proc } = await startWorker();
  details.push("Worker (`npx tsx worker/index.ts`) als Hintergrundprozess gestartet, Startmeldung erhalten.");

  try {
    // --- Fixture: Reservierung auf 'checked_in' setzen (Business-Regel fuer
    //     den eigentlichen Check-in-Flow existiert noch nicht als Service-
    //     Funktion — siehe Bericht — daher hier bewusst per Fixture-SQL). ---
    await pool.query(`update reservations set status = 'checked_in' where id = $1`, [writePath.reservationId]);
    details.push(`Fixture: Reservierung ${writePath.reservationId} auf status='checked_in' gesetzt.`);

    const ctx: ModuleContext = {
      userId: fixtures.hotelA.frontOffice.id,
      hotelId: fixtures.hotelA.id,
      role: "front_office",
      requestId: randomUUID(),
      module: "pms",
    };
    const checkedOut = await checkOut(ctx, { reservationId: writePath.reservationId, allowOpenBalance: false });
    details.push(`checkOut() aufgerufen -> status=${checkedOut.status}.`);

    // --- events-Eintrag fuer booking.checked_out ---
    const { rows: eventRows } = await pool.query(
      `select * from events where aggregate_type = 'reservation' and aggregate_id = $1 and event_type = 'booking.checked_out'`,
      [writePath.reservationId]
    );
    if (eventRows.length !== 1) {
      allOk = false;
      details.push(`FEHLER: erwartet 1 events-Eintrag fuer booking.checked_out, gefunden: ${eventRows.length}`);
    } else {
      details.push(`events-Eintrag fuer 'booking.checked_out' vorhanden.`);
    }

    // --- audit_log fuer den Checkout ---
    const { rows: auditRows } = await pool.query(
      `select * from audit_log where resource_type = 'reservation' and resource_id = $1 and action = 'reservation.checked_out'`,
      [writePath.reservationId]
    );
    if (auditRows.length !== 1) {
      allOk = false;
      details.push(`FEHLER: erwartet 1 audit_log-Eintrag fuer reservation.checked_out, gefunden: ${auditRows.length}`);
    } else {
      details.push(`audit_log-Eintrag fuer 'reservation.checked_out' vorhanden.`);
    }

    // --- Worker verarbeitet das Event -> tasks-Zeile (Housekeeping) ---
    try {
      await pollUntil(
        async () => {
          const { rows } = await pool.query(
            `select id, status, source, related_type, related_id, title from tasks
             where hotel_id = $1 and related_type = 'room' and related_id = $2 and source = 'system'
             order by created_at desc limit 1`,
            [fixtures.hotelA.id, fixtures.hotelA.roomId]
          );
          return rows[0];
        },
        { timeoutMs: 15_000, intervalMs: 1000, label: "Housekeeping-Task nach Check-out" }
      );
      details.push(`Worker hat 'booking.checked_out' verarbeitet -> Housekeeping-tasks-Zeile fuer Zimmer ${fixtures.hotelA.roomId} entstanden.`);
    } catch (e) {
      allOk = false;
      details.push(`FEHLER: ${e instanceof Error ? e.message : String(e)}`);
    }

    // --- pgboss.schedule: Night-Audit fuer beide Hotels registriert? ---
    const { rows: scheduleRows } = await pool.query(
      `select key, cron, timezone from pgboss.schedule where name = $1 and key = any($2::text[])`,
      [QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL, [fixtures.hotelA.id, fixtures.hotelB.id]]
    );
    if (scheduleRows.length !== 2) {
      allOk = false;
      details.push(
        `FEHLER: erwartet 2 pgboss.schedule-Eintraege (Hotel A + B) fuer '${QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL}', gefunden: ${scheduleRows.length}`
      );
    } else {
      const cronOk = scheduleRows.every((r) => r.cron === "0 4 * * *" && r.timezone === "Europe/Vienna");
      if (!cronOk) allOk = false;
      details.push(
        `pgboss.schedule: Night-Audit fuer beide Hotels registriert (cron='0 4 * * *', tz='Europe/Vienna') — ${cronOk ? "OK" : "FEHLER bei cron/tz"}.`
      );
    }

    // --- Night-Audit manuell antriggern (boss.send, statt auf den Cron zu warten) ---
    await sendJob(QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL, { hotelId: fixtures.hotelA.id });
    await sendJob(QUEUES.PMS_NIGHT_AUDIT_RUN_FOR_HOTEL, { hotelId: fixtures.hotelB.id });
    details.push("Night-Audit manuell fuer Hotel A und Hotel B ueber boss.send() angestossen.");

    for (const [label, hotelId] of [
      ["Hotel A", fixtures.hotelA.id],
      ["Hotel B", fixtures.hotelB.id],
    ] as const) {
      try {
        await pollUntil(
          async () => {
            const { rows } = await pool.query(
              `select id from audit_log
               where hotel_id = $1 and resource_type = 'hotel' and resource_id = $1 and action = 'pms.night_audit.no_op'
               order by created_at desc limit 1`,
              [hotelId]
            );
            return rows[0];
          },
          { timeoutMs: 15_000, intervalMs: 1000, label: `Night-Audit-Verarbeitung fuer ${label}` }
        );
        details.push(`Night-Audit fuer ${label} vom Worker verarbeitet (audit_log 'pms.night_audit.no_op' vorhanden).`);
      } catch (e) {
        allOk = false;
        details.push(`FEHLER: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await stopWorker(proc);
    details.push("Worker-Prozess wieder beendet (SIGTERM).");
  }

  record(5, "pg-boss real (Event-Bus + Scheduled Jobs, end-to-end)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "pg-boss real");
}
