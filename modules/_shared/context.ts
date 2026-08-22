import { randomUUID } from "node:crypto";
import { getActiveHotelId } from "@lib/hotel-context";
import { createClient } from "@lib/supabase/server";
import { getHotelRole } from "@modules/rbac/service";
import type { HotelRole } from "@modules/rbac/permissions";
import { ForbiddenError, UnauthorizedError } from "./errors";

/**
 * Minimaler Kontext, den `executeWrite()` (`write.ts`) für den Audit-Insert
 * braucht. `role` ist hier bewusst `string`, nicht `HotelRole` — Hintergrund-
 * Jobs (siehe `createSystemContext`) haben keine RBAC-Rolle, laufen mit
 * Service-Role-Rechten und wollen trotzdem einen sprechenden `actor_role`-
 * Wert im Audit-Log (freies `text`-Feld, kein FK/Check-Constraint dort).
 */
export interface WriteContext {
  userId: string | null;
  hotelId: string;
  role: string;
  requestId: string;
  module: string;
}

/**
 * Kontext für User-getriebene Requests (API-Route → Modul-Funktion).
 * Engt `role` auf die echten RBAC-Rollen ein, damit `requirePermission()`
 * `PERMISSIONS[ctx.role]` typsicher nachschlagen kann.
 *
 * Annahme: der Plan zeigt `executeWrite()` mit `ctx.module` im Audit-Insert,
 * ohne zu spezifizieren, woher das kommt. Hier: der aufrufende Route-Handler
 * übergibt den Modul-Namen explizit an `getModuleContext(req, module)` — er
 * kennt ihn ohnehin aus seinem eigenen Pfad, z. B. `/api/v1/pms/...` → `"pms"`.
 */
export interface ModuleContext extends WriteContext {
  userId: string;
  role: HotelRole;
  /**
   * Aus dem `Idempotency-Key`-Header, falls gesetzt.
   * TODO: Prüfung/Speicherung gegen `idempotency_keys` (K6) noch nicht
   * implementiert — Tabelle existiert bereits (siehe Migration), die
   * eigentliche Retry-Erkennung ist Phase-1-Arbeit.
   */
  idempotencyKey?: string;
}

/**
 * Baut den `ModuleContext` für einen Request:
 * 1. Supabase-Session aus Cookies (`lib/supabase/server.ts`)
 * 2. aktives Hotel aus Cookie (`lib/hotel-context.ts`)
 * 3. Rolle via `hotel_role()`-RPC (`modules/rbac/service.ts`)
 * 4. `requestId` für Audit-Korrelation
 *
 * Wirft `UnauthorizedError` (401), wenn keine gültige Session vorliegt —
 * in der Praxis sollte `proxy.ts` anonyme Zugriffe auf `/api/v1/*` schon
 * vorher abfangen, dies ist die zweite Verteidigungslinie direkt an der
 * Modul-Grenze. Wirft `ForbiddenError`, wenn der User kein aktives
 * Mitglied des (Cookie-)Hotels ist.
 */
export async function getModuleContext(req: Request, module: string): Promise<ModuleContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const hotelId = await getActiveHotelId();
  if (!hotelId) throw new ForbiddenError("hotel.member");

  const role = await getHotelRole(hotelId);
  if (!role) throw new ForbiddenError("hotel.member");

  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;

  return {
    userId: user.id,
    hotelId,
    role,
    requestId: randomUUID(),
    module,
    idempotencyKey,
  };
}

/**
 * System-Kontext für Hintergrund-Jobs (kein anfragender User, z. B.
 * `modules/pms/jobs.ts` Night-Audit oder `modules/housekeeping/tasks/jobs.ts`
 * Checkout-Subscriber). Jobs rufen `requirePermission()` nicht auf — sie
 * laufen mit Service-Role-Rechten und prüfen stattdessen `assertModuleEnabled()`.
 */
export function createSystemContext(hotelId: string, module: string): WriteContext {
  return {
    userId: null,
    hotelId,
    role: "system",
    requestId: randomUUID(),
    module,
  };
}
