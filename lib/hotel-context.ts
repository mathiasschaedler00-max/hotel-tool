import { cookies } from "next/headers";
import { createClient } from "@lib/supabase/server";
import { createServiceClient } from "@lib/supabase/service";

/**
 * Cookie-basierte "aktives Hotel"-Auswahl — Analogon zu `company-filter.ts`
 * aus dem Referenzprojekt (`/Users/mathias/Ticketsytem v3`). Unterschied:
 * dort ist Multi-Company gleichzeitig wählbar (Dashboard-Filter über mehrere
 * Firmen); ein PMS-Mitarbeiter arbeitet dagegen immer in genau EINEM aktiven
 * Hotel gleichzeitig — daher hier ein einzelner Cookie-Wert statt einer
 * Kommaliste.
 */
export const ACTIVE_HOTEL_COOKIE = "hotel_id";

interface HotelSummary {
  id: string;
  name: string;
}

/** Alle Hotel-IDs, in denen der aktuelle User aktives Mitglied ist. */
export async function getUserHotelIds(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const service = createServiceClient();
  const { data, error } = await service
    .from("hotel_members")
    .select("hotel_id")
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[hotel-context] getUserHotelIds failed", error);
    return [];
  }
  return (data ?? []).map((row) => row.hotel_id as string);
}

/** Alle Hotels (id + name) des aktuellen Users, z. B. für einen künftigen Hotel-Switcher. */
export async function getUserHotels(): Promise<HotelSummary[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const service = createServiceClient();
  const { data, error } = await service
    .from("hotel_members")
    .select("hotels(id, name)")
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) {
    console.error("[hotel-context] getUserHotels failed", error);
    return [];
  }
  return (data ?? [])
    .map((row) => row.hotels as unknown as HotelSummary | null)
    .filter((hotel): hotel is HotelSummary => hotel !== null);
}

/**
 * Aktives Hotel aus dem Cookie. Fällt auf das erste Hotel des Users zurück,
 * wenn der Cookie fehlt oder auf ein Hotel zeigt, in dem der User kein
 * (mehr) aktives Mitglied ist. Gibt `null` zurück, wenn der User in gar
 * keinem Hotel Mitglied ist.
 */
export async function getActiveHotelId(): Promise<string | null> {
  const allIds = await getUserHotelIds();
  if (allIds.length === 0) return null;

  const cookieStore = await cookies();
  const raw = cookieStore.get(ACTIVE_HOTEL_COOKIE)?.value;
  if (raw && allIds.includes(raw)) return raw;
  return allIds[0];
}

/** Setzt das aktive Hotel (z. B. aus einem künftigen Hotel-Switcher-UI heraus). */
export async function setActiveHotelId(hotelId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_HOTEL_COOKIE, hotelId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}
