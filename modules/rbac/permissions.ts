import { ForbiddenError } from "@modules/_shared/errors";
import type { ModuleContext } from "@modules/_shared/context";

/**
 * Rollen→Permission-Matrix (K2).
 *
 * Annahme — Teil A prüfen: Rollenliste + genaue Rechte sind noch nicht final
 * spezifiziert. Diese 7 Startrollen + Zuordnung sind ein plausibler Entwurf
 * für ein Hotel-PMS, kein bestätigter Fachentwurf. Migration in eine
 * DB-Tabelle bleibt additiv möglich (siehe docs/adr/0005).
 *
 * Muss exakt mit dem `check`-Constraint auf `hotel_members.role` in
 * supabase/migrations/..._tenants_and_rls_core.sql übereinstimmen.
 */
export const PERMISSIONS = {
  owner: ["*"],
  general_manager: ["pms.*", "housekeeping.*", "accounting.read"],
  front_office: ["pms.reservations.read", "pms.reservations.write", "pms.guests.*", "pms.folios.*"],
  housekeeping_staff: ["housekeeping.tasks.*", "pms.rooms.read"],
  accounting: ["pms.folios.read", "pms.payments.*"],
  maintenance: ["housekeeping.tasks.read", "housekeeping.tasks.update"],
  readonly: ["*.read"],
} as const satisfies Record<string, string[]>; // Annahme — Teil A prüfen (K2)

export type HotelRole = keyof typeof PERMISSIONS;

export const HOTEL_ROLES = Object.keys(PERMISSIONS) as HotelRole[];

/**
 * Prüft, ob `ctx.role` die geforderte Permission besitzt.
 * Wird **innerhalb** der Modul-Service-Funktion aufgerufen, nie im
 * Route-Handler (Vorgabe #1), und immer NACH `assertModuleEnabled()`
 * (siehe docs/adr/0004 — Reihenfolge verhindert ein 403-vs-404-Leck).
 *
 * Abweichung vom Plan-Codebeispiel: das dort gezeigte Matching prüft nur
 * Prefix-Wildcards (`"pms.*"` deckt `"pms.reservations.read"` ab), aber nicht
 * Suffix-Wildcards (`"*.read"`, von der `readonly`-Rolle oben verwendet).
 * Wortwörtlich übernommen wäre `readonly` damit faktisch rechtlos — offensichtlich
 * nicht die Absicht der Matrix. Fix hier: zusätzliche Prüfung auf
 * Suffix-Wildcards ergänzt.
 */
export function requirePermission(ctx: Pick<ModuleContext, "role">, permission: string): void {
  const allowed: readonly string[] = PERMISSIONS[ctx.role] ?? [];
  const ok = allowed.some((p) => {
    if (p === "*" || p === permission) return true;
    if (p.endsWith(".*")) return permission.startsWith(p.slice(0, -1));
    if (p.startsWith("*.")) return permission.endsWith(p.slice(1));
    return false;
  });
  if (!ok) throw new ForbiddenError(permission);
}
