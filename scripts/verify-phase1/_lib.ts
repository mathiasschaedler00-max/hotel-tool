/**
 * Wiederverwendet die Phase-0-Testinfrastruktur statt eine neue aufzubauen —
 * siehe Plan (`/Users/mathias/.claude/plans/teil-b-die-staged-codd.md`,
 * Abschnitt "Verifikation"): "Jeder Phase-1-Schritt legt analog
 * `scripts/verify-phase1/NN-*.ts` an und erweitert einen gemeinsamen Runner
 * — statt einer neuen Test-Infrastruktur." `record()`/`printFinalReport()`/
 * `rawPool()`/... sind bereits generisch (nicht Phase-0-spezifisch).
 */
export * from "../verify-foundation/_lib";

import { randomUUID } from "node:crypto";
import { rawPool, assertTrue } from "../verify-foundation/_lib";
import type { ModuleContext } from "@modules/_shared/context";

const DEMO_HOTEL_NAME = "Demo Hotel (API-Test)";

/**
 * Baut einen echten `ModuleContext` fürs Demo Hotel (owner-Rolle) — für
 * Tests, die kein Zwei-Hotel-Fixture brauchen (anders als die
 * Cross-Tenant-Tests in 01-*), z. B. Zimmerverwaltung oder
 * Überbuchungsschutz. Erstmals genutzt von 02-room-management.ts.
 */
export async function findDemoHotelContext(): Promise<ModuleContext> {
  const pool = rawPool();
  const { rows: hotelRows } = await pool.query<{ id: string }>(`select id from hotels where name = $1`, [
    DEMO_HOTEL_NAME,
  ]);
  assertTrue(hotelRows[0], `Demo Hotel "${DEMO_HOTEL_NAME}" nicht gefunden`);
  const hotelId = hotelRows[0].id;

  const { rows: memberRows } = await pool.query<{ user_id: string; role: string }>(
    `select user_id, role from hotel_members where hotel_id = $1 and role = 'owner' limit 1`,
    [hotelId]
  );
  assertTrue(memberRows[0], `Kein owner-Mitglied fuer Demo Hotel gefunden`);

  return {
    userId: memberRows[0].user_id,
    hotelId,
    role: memberRows[0].role as ModuleContext["role"],
    requestId: randomUUID(),
    module: "pms",
  };
}
