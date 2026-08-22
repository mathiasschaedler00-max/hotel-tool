import { getActiveHotelId } from "@lib/hotel-context";
import { getHotelById } from "@modules/pms/hotels/service";
import { listRooms } from "@modules/pms/rooms/service";
import { RoomList } from "./room-list";

/**
 * Zimmerverwaltung + Zimmerstatus — Phase 1, Schritt 1. Kein eigener
 * Screen im Design-Prototyp (die 8 Referenz-Screens setzen den
 * Belegungsplan als Einstieg voraus, siehe docs/design/hotel-tool-design-
 * referenz.md), aber die Statusfarben-/Zustands-Konventionen von dort
 * gelten hier bereits 1:1 — Schritt 2 (Tape Chart) baut visuell darauf auf.
 *
 * Bewusst NICHT unter `/` (Root) — `proxy.ts` behandelt `/` als
 * öffentliche Route (für eine künftige Marketing-/Landingpage), ein echtes
 * Dashboard braucht eine geschützte Route wie diese hier.
 */
export default async function RoomsPage() {
  const hotelId = await getActiveHotelId();
  if (!hotelId) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-bg p-6">
        <p className="text-text-2">Kein Hotel für diesen Account gefunden.</p>
      </div>
    );
  }

  const [hotel, rooms] = await Promise.all([getHotelById(hotelId), listRooms({ hotelId })]);

  return (
    <div className="min-h-full flex-1 bg-bg p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold text-text">{hotel.name}</h1>
        <p className="mb-6 text-sm text-text-2">Zimmerverwaltung</p>
        <RoomList rooms={rooms} />
      </div>
    </div>
  );
}
