import Link from "next/link";
import { getActiveHotelId } from "@lib/hotel-context";
import { getHotelById } from "@modules/pms/hotels/service";
import { listRoomTypes, listDeactivatedRoomTypes } from "@modules/pms/room-types/service";
import { listRooms } from "@modules/pms/rooms/service";
import { CategoryList } from "./category-list";

/**
 * Kategorien-Verwaltung — Ergänzung zu Screen 8 "Zimmerverwaltung" (Auftrag
 * 23.08.2026): Preis/Nacht und max. Personen hängen an der Kategorie
 * (`room_types`), aber es gab bisher keinen Ort, sie zu ändern — im
 * Zimmer-Modal sind sie zu Recht gesperrt (siehe schema.ts-Kommentar dort).
 *
 * Basispreis hier ist bewusst nur die Basisrate — Saison-/Wochentagspreise
 * (Raten-Management, Schritt 3/V4) und dynamische Anpassung (Revenue-KI,
 * Phase 5) kommen später, nicht hier vorwegnehmen.
 */
export default async function CategoriesPage() {
  const hotelId = await getActiveHotelId();
  if (!hotelId) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center bg-bg p-6">
        <p className="text-text-2">Kein Hotel für diesen Account gefunden.</p>
      </div>
    );
  }

  const [hotel, roomTypes, deactivatedRoomTypes, rooms] = await Promise.all([
    getHotelById(hotelId),
    listRoomTypes({ hotelId }),
    listDeactivatedRoomTypes({ hotelId }),
    listRooms({ hotelId }),
  ]);

  // Als Objekt statt Map — Server→Client-Serialisierung erlaubt keine Maps.
  const roomCountByType: Record<string, number> = {};
  for (const room of rooms) {
    roomCountByType[room.room_type_id] = (roomCountByType[room.room_type_id] ?? 0) + 1;
  }

  return (
    <div className="min-h-full flex-1 bg-bg p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/rooms" className="mb-3 inline-block text-sm text-text-2 hover:text-text">
          ← Zurück zu Zimmern
        </Link>
        <h1 className="mb-1 text-xl font-semibold text-text">{hotel.name}</h1>
        <p className="mb-6 text-sm text-text-2">Kategorien-Verwaltung</p>
        <CategoryList
          roomTypes={roomTypes}
          deactivatedRoomTypes={deactivatedRoomTypes}
          roomCountByType={roomCountByType}
        />
      </div>
    </div>
  );
}
