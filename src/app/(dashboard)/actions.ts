"use server";

import { revalidatePath } from "next/cache";
import { setActiveHotelId } from "@lib/hotel-context";

/**
 * Server Action für den Hotel-Umschalter (`hotel-switcher.tsx`) — setzt den
 * Cookie über das vorhandene `lib/hotel-context.ts#setActiveHotelId()` und
 * sorgt dafür, dass alle Server Components der Dashboard-Gruppe (Zimmer,
 * Belegungsplan) den neuen Wert beim nächsten Render sehen.
 */
export async function switchHotelAction(hotelId: string): Promise<void> {
  await setActiveHotelId(hotelId);
  revalidatePath("/", "layout");
}
