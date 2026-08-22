import { createClient } from "@lib/supabase/server";
import type { HotelRole } from "./permissions";
import { HOTEL_ROLES } from "./permissions";

/**
 * Liest die Rolle des aktuell angemeldeten Users für ein Hotel über die
 * `hotel_role()`-SQL-Funktion (siehe supabase/migrations/..._tenants_and_rls_core.sql).
 * Läuft über den Cookie-basierten Server-Client (RLS-Kontext = `auth.uid()`),
 * nicht über den Service-Client — die Funktion ist `security definer` und
 * liest intern ohnehin `auth.uid()`.
 *
 * Gibt `null` zurück, wenn der User kein aktives Mitglied dieses Hotels ist.
 */
export async function getHotelRole(hotelId: string): Promise<HotelRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hotel_role", { p_hotel_id: hotelId });
  if (error) {
    console.error("[rbac] hotel_role() RPC failed", error);
    return null;
  }
  if (!data || !isHotelRole(data)) return null;
  return data;
}

function isHotelRole(value: string): value is HotelRole {
  return (HOTEL_ROLES as string[]).includes(value);
}
