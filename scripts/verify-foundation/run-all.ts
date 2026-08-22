/**
 * Orchestriert die komplette Phase-0-Abnahme (8-Punkte-Testszenario, siehe
 * /Users/mathias/.claude/plans/teil-b-die-staged-codd.md, Abschnitt
 * "Verifikation (Abnahme von Phase 0)") gegen die echte Supabase-DB
 * (Frankfurt).
 *
 * Ausfuehren mit: `npx tsx scripts/verify-foundation/run-all.ts`
 * (aus dem Projekt-Root, damit `.env.local`-relative Pfade und
 * `worker/index.ts` gefunden werden).
 *
 * Punkt 7 (Backup/Restore) wird bewusst NICHT hier ausgefuehrt — braucht ein
 * zweites Supabase-Projekt (Kosten-/Account-Entscheidung), siehe Auftrag.
 */
import { record, printFinalReport, closeSharedPool } from "./_lib";
import { setupFixtures } from "./01-setup";
import { testTenantIsolation } from "./02-tenant-isolation";
import { testWritePath, type WritePathResult } from "./03-write-path";
import { testEntitlements } from "./04-entitlements";
import { testPgBoss } from "./05-pgboss";
import { testMfa } from "./06-mfa";
import { testAiDecisionLog } from "./08-ai-decision-log";
import { getBoss } from "@lib/queue/boss";

async function main(): Promise<void> {
  console.log("Phase-0-Abnahmetest gestartet — echte Supabase-DB (Frankfurt).\n");

  const fixtures = await setupFixtures();

  try {
    await testTenantIsolation(fixtures);
  } catch (e) {
    console.error("Punkt 2 abgebrochen:", e instanceof Error ? e.message : e);
  }

  let writePath: WritePathResult | undefined;
  try {
    writePath = await testWritePath(fixtures);
  } catch (e) {
    console.error("Punkt 3 abgebrochen:", e instanceof Error ? e.message : e);
  }

  try {
    await testEntitlements(fixtures);
  } catch (e) {
    console.error("Punkt 4 abgebrochen:", e instanceof Error ? e.message : e);
  }

  if (writePath) {
    try {
      await testPgBoss(fixtures, writePath);
    } catch (e) {
      console.error("Punkt 5 abgebrochen:", e instanceof Error ? e.message : e);
    }
  } else {
    record(5, "pg-boss real (Event-Bus + Scheduled Jobs, end-to-end)", "SKIP", "Punkt 3 (Schreibpfad) ist fehlgeschlagen, es gibt keine Reservierung zum Einchecken/Checkout.");
  }

  try {
    await testMfa(fixtures);
  } catch (e) {
    console.error("Punkt 6 abgebrochen:", e instanceof Error ? e.message : e);
  }

  record(7, "Backup/Restore (separates Scratch-Supabase-Projekt)", "SKIP", "Braucht ein zweites Supabase-Projekt (Kosten-/Account-Entscheidung) — laut Auftrag nicht ohne Ruecksprache mit Mathias anzulegen.");

  try {
    await testAiDecisionLog(fixtures);
  } catch (e) {
    console.error("Punkt 8 abgebrochen:", e instanceof Error ? e.message : e);
  }

  printFinalReport();

  // Sauber herunterfahren, damit der Prozess terminiert (pg-boss + pg-Pool
  // halten sonst offene Connections/Timers).
  try {
    const boss = await getBoss();
    await boss.stop({ close: true });
  } catch {
    // best effort
  }
  await closeSharedPool();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fataler Fehler im Abnahmetest:", e);
    process.exit(1);
  });
