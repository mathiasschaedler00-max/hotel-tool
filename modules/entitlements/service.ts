import { createServiceClient } from "@lib/supabase/service";
import { ModuleDisabledError } from "@modules/_shared/errors";
import type { ModuleKey } from "./types";

/**
 * Prüft `hotel_modules.enabled` über den Service-Client (bewusst nicht über
 * RLS/den User-Kontext — diese Prüfung ist ein internes Autorisierungs-Gate,
 * keine User-Datenabfrage, siehe Vorgabe #2). Fail-closed: fehlt die Zeile
 * ganz (kein Seed für dieses Hotel+Modul), gilt das Modul als deaktiviert.
 */
export async function isModuleEnabled(hotelId: string, key: ModuleKey): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service
    .from("hotel_modules")
    .select("enabled")
    .eq("hotel_id", hotelId)
    .eq("module_key", key)
    .maybeSingle();

  if (error) {
    console.error("[entitlements] isModuleEnabled query failed", error);
    return false;
  }
  return data?.enabled ?? false;
}

/**
 * Wirft `ModuleDisabledError` (→ HTTP 404, siehe modules/_shared/response.ts),
 * wenn das Modul für dieses Hotel nicht aktiv ist.
 *
 * ZENTRALE ENTSCHEIDUNG (docs/adr/0004): wird als ERSTER Schritt in jeder
 * Modul-Funktion aufgerufen, VOR `requirePermission()` — sonst wäre "403 vs.
 * 404" selbst schon ein Informationsleck darüber, ob das Modul existiert.
 */
export async function assertModuleEnabled(hotelId: string, key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(hotelId, key))) {
    throw new ModuleDisabledError(key);
  }
}
