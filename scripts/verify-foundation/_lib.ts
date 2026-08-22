/**
 * Gemeinsame Helfer für die Phase-0-Abnahmetests (scripts/verify-foundation/).
 *
 * WICHTIG: gibt niemals Rohwerte von SUPABASE_SERVICE_ROLE_KEY,
 * NEXT_PUBLIC_SUPABASE_ANON_KEY, DATABASE_URL, DATABASE_URL_SESSION oder
 * generierten Test-User-Passwörtern aus (weder Console-Log noch Datei).
 *
 * Läuft mit `npx tsx` (siehe package.json — kein eigenes Build nötig).
 * Lädt `.env.local` selbst (wie `worker/index.ts`), weil dieses Skript
 * außerhalb von Next.js läuft.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env var ${name} ist nicht gesetzt (siehe .env.local).`);
  return v;
}

export function serviceClient(): SupabaseClient {
  return createSupabaseClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Neuer Anon-Key-Client pro Aufruf — jede Test-Session braucht ihren eigenen
 * Client, sonst teilen sich mehrere "eingeloggte User" denselben In-Memory-
 * Session-State (kein persistSession, aber der Client hält den Access-Token
 * trotzdem im Prozess-Speicher). */
export function anonClient(): SupabaseClient {
  return createSupabaseClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let sharedPool: Pool | undefined;
/** Roher pg-Pool über den Transaction-Pooler — für Fixture-Setup und
 * Verifikations-Queries (Service-Role-Ebene, wie lib/db/pool.ts). */
export function rawPool(): Pool {
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 5 });
  }
  return sharedPool;
}

export async function closeSharedPool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}

export function randomPassword(): string {
  // Nur intern verwendet (Admin-API createUser + spätere signInWithPassword-
  // Aufrufe im selben Prozess) — wird NIE geloggt oder persistiert.
  return `Tt!${cryptoRandom()}Ab9`;
}

function cryptoRandom(): string {
  // Kein Bedarf an node:crypto-Import extra — Math.random reicht für ein
  // Test-Passwort, das nie geloggt/gespeichert wird und nur für die Dauer
  // dieses Prozesses existiert.
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export type StepResult = "PASS" | "FAIL" | "SKIP";

export interface ReportEntry {
  point: number;
  title: string;
  result: StepResult;
  detail: string;
}

export const report: ReportEntry[] = [];

export function record(point: number, title: string, result: StepResult, detail: string): void {
  report.push({ point, title, result, detail });
  const tag = result === "PASS" ? "[BESTANDEN]" : result === "FAIL" ? "[NICHT BESTANDEN]" : "[UEBERSPRUNGEN]";
  console.log(`\n${tag} Punkt ${point}: ${title}`);
  for (const line of detail.split("\n")) {
    console.log(`   ${line}`);
  }
}

export function printFinalReport(): void {
  console.log("\n\n==================== ABNAHME-BERICHT PHASE 0 ====================");
  for (const e of report) {
    console.log(`Punkt ${e.point} — ${e.title}: ${e.result}`);
  }
  console.log("===================================================================\n");
}

export function assertTrue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion fehlgeschlagen: ${message}`);
}

/** Poll-Helfer statt fixer sleeps — wartet bis `check()` truthy zurückgibt oder das Timeout erreicht ist. */
export async function pollUntil<T>(
  check: () => Promise<T | undefined | null | false>,
  opts: { timeoutMs: number; intervalMs: number; label: string }
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new Error(`Timeout beim Warten auf: ${opts.label} (nach ${opts.timeoutMs}ms)`);
}
