import { getActiveHotelId } from "@lib/hotel-context";
import { getHotelById } from "@modules/pms/hotels/service";
import { listRoomTypes } from "@modules/pms/room-types/service";
import { listRooms } from "@modules/pms/rooms/service";
import { listReservationsInRange } from "@modules/pms/reservations/service";
import { CalendarBoard } from "./calendar-board";
import { DayList } from "./day-list";

const DEFAULT_DESKTOP_DAYS = 14;
const ALLOWED_DESKTOP_DAYS = [7, 14, 31] as const;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Belegungsplan / Tape Chart (Phase 1, Schritt 2). Server Component: liest
 * Zeitraum + Filter aus URL-Suchparametern, lädt alles direkt über die
 * Modul-Funktionen (kein API-Roundtrip, wie schon bei `/rooms`).
 *
 * `?from=YYYY-MM-DD` steuert das Desktop-Gitter (14-Tage-Fenster, Default
 * heute), `?date=YYYY-MM-DD` die mobile Tagesliste (Default heute) —
 * unabhängig voneinander navigierbar. Beide Views werden IMMER serverseitig
 * gerendert und per CSS-Breakpoint umgeschaltet (`hidden sm:block` /
 * `sm:hidden`), siehe Plan "Mobile-First vs. Desktop-Design — entschieden":
 * kein JS-Viewport-Detection nötig, funktioniert auch ohne Hydration.
 *
 * Eine einzige `listReservationsInRange()`-Query deckt beide Views ab — die
 * Query-Range ist die Vereinigung aus Desktop-Fenster und mobilem Einzeltag,
 * falls per `?date=` außerhalb des Desktop-Fensters navigiert wird.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; date?: string; days?: string }>;
}) {
  const params = await searchParams;
  const hotelId = await getActiveHotelId();

  if (!hotelId) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center p-6">
        <p className="text-text-2">Kein Hotel für diesen Account gefunden.</p>
      </div>
    );
  }

  const today = todayIso();
  const rangeFrom = params.from && ISO_DATE_PATTERN.test(params.from) ? params.from : today;
  const desktopDays = ALLOWED_DESKTOP_DAYS.includes(Number(params.days) as (typeof ALLOWED_DESKTOP_DAYS)[number])
    ? Number(params.days)
    : DEFAULT_DESKTOP_DAYS;
  const rangeToExclusive = addDays(rangeFrom, desktopDays);
  const mobileDate = params.date && ISO_DATE_PATTERN.test(params.date) ? params.date : today;
  const mobileDateNextDay = addDays(mobileDate, 1);

  const queryFrom = mobileDate < rangeFrom ? mobileDate : rangeFrom;
  const queryTo = mobileDateNextDay > rangeToExclusive ? mobileDateNextDay : rangeToExclusive;

  const [hotel, roomTypes, rooms, reservations] = await Promise.all([
    getHotelById(hotelId),
    listRoomTypes({ hotelId }),
    listRooms({ hotelId }),
    listReservationsInRange({ hotelId }, queryFrom, queryTo),
  ]);

  return (
    // h-full + flex-col: Voraussetzung dafür, dass das Gitter unten seine
    // volle verfügbare Höhe kennt und selbst scrollen kann, statt einer
    // festen vh-Schätzung zu folgen (Review-Fund, 22.08.2026).
    <div className="flex h-full flex-col bg-bg">
      <div className="shrink-0 border-b border-line px-4 py-4 sm:px-8">
        <h1 className="text-xl font-semibold text-text">{hotel.name}</h1>
        <p className="text-sm text-text-2">Belegungsplan</p>
      </div>

      <div className="hidden min-h-0 flex-1 sm:block">
        <CalendarBoard
          roomTypes={roomTypes}
          rooms={rooms}
          reservations={reservations}
          rangeFrom={rangeFrom}
          days={desktopDays}
          today={today}
        />
      </div>
      <div className="sm:hidden">
        <DayList rooms={rooms} reservations={reservations} date={mobileDate} today={today} />
      </div>
    </div>
  );
}
