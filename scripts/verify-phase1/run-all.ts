/**
 * Orchestriert die Phase-1-Verifikation, ein Skript pro Schritt (siehe Plan-
 * Abschnitt "Verifikation"). Aktuell nur Schritt 2 (Cross-Tenant-Fix
 * folios/payments) — künftige Schritte hängen sich hier mit ihrem eigenen
 * `NN-*.ts` an, analog zu `scripts/verify-foundation/run-all.ts`.
 *
 * Ausführen mit: `npx tsx scripts/verify-phase1/run-all.ts`
 */
import { printFinalReport, closeSharedPool } from "./_lib";
import { setupFixtures } from "../verify-foundation/01-setup";
import { testCrossTenantFoliosPayments } from "./01-cross-tenant-folios-payments";
import { getBoss } from "@lib/queue/boss";

async function main(): Promise<void> {
  console.log("Phase-1-Verifikation gestartet — echte Supabase-DB (Frankfurt).\n");

  const fixtures = await setupFixtures();

  try {
    await testCrossTenantFoliosPayments(fixtures);
  } catch (e) {
    console.error("Schritt 2 (Cross-Tenant-Fix) abgebrochen:", e instanceof Error ? e.message : e);
  }

  printFinalReport();

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
    console.error("Fataler Fehler in der Phase-1-Verifikation:", e);
    process.exit(1);
  });
