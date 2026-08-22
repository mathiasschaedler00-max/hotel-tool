import Link from "next/link";
import { formatDate } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { ReservationWithDetails } from "@modules/pms/reservations/service";
import { ROOM_STATUS_META, type RoomStatus } from "../rooms/room-status";
import { isVisibleOnCalendar } from "./reservation-status";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const DOT_COLOR_CLASSES: Record<string, string> = {
  green: "bg-green",
  blue: "bg-blue",
  yellow: "bg-yellow",
  red: "bg-red",
};

/** Gleiche Farb-/Label-Zuordnung wie `room-list.tsx#StatusDot` (aus `room-status.ts` importiert, nicht neu definiert). */
function StatusDot({ status }: { status: RoomStatus }) {
  const meta = ROOM_STATUS_META[status];
  const colorClass = DOT_COLOR_CLASSES[meta.color];
  return (
    <span
      aria-hidden
      className={
        meta.filled
          ? `inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`
          : `inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent ${colorClass.replace("bg-", "border-")}`
      }
    />
  );
}

/**
 * Mobile Tagesliste (< 640px) — bewusst KEIN geschrumpftes Gitter (siehe
 * Plan "Mobile-First vs. Desktop-Design — entschieden"): ein Tag pro
 * Ansicht, vor/zurück blätterbar, eine Zeile pro Zimmer.
 *
 * Reiner Server Component (kein "use client" nötig) — Navigation läuft über
 * `?date=`-Links, keine Client-Interaktivität erforderlich.
 */
export function DayList({
  rooms,
  reservations,
  date,
  today,
}: {
  rooms: Room[];
  reservations: ReservationWithDetails[];
  date: string;
  today: string;
}) {
  const reservationByRoom = new Map<string, ReservationWithDetails>();
  for (const r of reservations) {
    if (!r.room_id) continue;
    if (!isVisibleOnCalendar(r.status)) continue;
    if (r.check_in_date <= date && date < r.check_out_date) {
      reservationByRoom.set(r.room_id, r);
    }
  }

  const occupiedCount = rooms.filter((room) => {
    const r = reservationByRoom.get(room.id);
    return r && (r.status === "confirmed" || r.status === "checked_in");
  }).length;
  const occupancyPct = rooms.length > 0 ? Math.round((occupiedCount / rooms.length) * 100) : 0;

  const prevDate = addDays(date, -1);
  const nextDate = addDays(date, 1);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/calendar?date=${prevDate}`}
          aria-label="Vorheriger Tag"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-surface text-text"
        >
          ←
        </Link>
        <div className="text-center">
          <p className="text-sm font-semibold text-text">
            {formatDate(date)}
            {date === today && <span className="ml-1 font-normal text-text-3">(heute)</span>}
          </p>
          <p className="font-mono text-xs text-text-3">{occupancyPct}% ausgelastet</p>
        </div>
        <Link
          href={`/calendar?date=${nextDate}`}
          aria-label="Nächster Tag"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-surface text-text"
        >
          →
        </Link>
      </div>

      {rooms.length === 0 ? (
        <p className="text-sm text-text-2">Noch keine Zimmer angelegt.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rooms.map((room) => {
            const reservation = reservationByRoom.get(room.id);
            let statusText: string;

            let guestName: string | null = null;
            if (reservation) {
              guestName = reservation.guest
                ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
                : "Ohne Gast";
              if (reservation.check_in_date === date) {
                const nights = daysBetween(reservation.check_in_date, reservation.check_out_date);
                statusText = `Anreise heute · ${nights} ${nights === 1 ? "Nacht" : "Nächte"}`;
              } else if (reservation.check_out_date === date) {
                statusText = "Abreise heute";
              } else {
                statusText = `In-House · bis ${formatDate(reservation.check_out_date)}`;
              }
            } else {
              statusText = room.status === "available" ? "Frei" : ROOM_STATUS_META[room.status].label;
            }

            return (
              <li key={room.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
                <StatusDot status={room.status} />
                <span className="w-10 shrink-0 font-mono text-sm font-semibold text-text">{room.room_number}</span>
                {/* Zeilenumbruch statt Kürzen (`truncate`) — das Abreisedatum ist
                 * eine für den Betrieb kritische Information und darf nicht
                 * abgeschnitten werden (bei 390px sonst z.B. "bis 24. ..."). */}
                <span className="min-w-0 flex-1 text-sm text-text-2">
                  {guestName && <span className="block font-medium text-text">{guestName}</span>}
                  <span className="block">{statusText}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
