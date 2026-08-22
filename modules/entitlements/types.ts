/**
 * Modul-Katalog. Annahme — Teil D prüfen: vollständiger Katalog + ob weitere
 * Module (z. B. `accounting`, `channel-manager`) in Phase 1+ dazukommen, ist
 * noch nicht spezifiziert. Muss mit den Seed-Zeilen in
 * supabase/migrations/..._entitlements.sql übereinstimmen.
 */
export type ModuleKey = "pms" | "housekeeping" | "notifications";

export interface HotelModuleRow {
  hotelId: string;
  moduleKey: ModuleKey;
  enabled: boolean;
  enabledAt: string | null;
  enabledBy: string | null;
  config: Record<string, unknown>;
}
