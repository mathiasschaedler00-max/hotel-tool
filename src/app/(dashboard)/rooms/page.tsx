import { getActiveHotelId } from "@lib/hotel-context";
import { getHotelById } from "@modules/pms/hotels/service";
import { listRooms } from "@modules/pms/rooms/service";
import { listRoomTypes } from "@modules/pms/room-types/service";
import { listReservationsInRange } from "@modules/pms/reservations/service";
import { RoomList } from "./room-list";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  const today = todayIso();
  const [hotel, rooms, roomTypes, reservationsToday] = await Promise.all([
    getHotelById(hotelId),
    listRooms({ hotelId }),
    listRoomTypes({ hotelId }),
    listReservationsInRange({ hotelId }, today, addDays(today, 1)),
  ]);

  // "Belegt" (blau) ist ein rein abgeleiteter Anzeigestatus (siehe
  // room-status.ts#getRoomDisplayStatus) — nie in rooms.status gespeichert.
  const checkedInTodayRoomIds = new Set(
    reservationsToday.filter((r) => r.status === "checked_in" && r.room_id).map((r) => r.room_id as string)
  );

  return (
    <div className="min-h-full flex-1 bg-bg p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold text-text">{hotel.name}</h1>
        <p className="mb-6 text-sm text-text-2">Zimmerverwaltung</p>
        <RoomList rooms={rooms} roomTypes={roomTypes} checkedInTodayRoomIds={checkedInTodayRoomIds} />
      </div>
    </div>
  );
}
