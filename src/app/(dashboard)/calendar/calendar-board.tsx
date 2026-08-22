"use client";

import { useMemo, useState } from "react";
import { formatDate, formatWeekdayShort } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { RoomType } from "@modules/pms/room-types/service";
import type { ReservationWithDetails } from "@modules/pms/reservations/service";
import { ROOM_STATUS_META, type RoomStatus } from "../rooms/room-status";
import { RESERVATION_STATUS_META, isVisibleOnCalendar } from "./reservation-status";
import { ReservationDetailPanel } from "./reservation-detail-panel";

const ROOM_COL_PX = 168;
const DAY_COL_MIN_PX = 68;

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
function RoomStatusDot({ status }: { status: RoomStatus }) {
  const meta = ROOM_STATUS_META[status];
  const colorClass = DOT_COLOR_CLASSES[meta.color];
  return (
    <span
      aria-hidden
      title={meta.label}
      className={
        meta.filled
          ? `inline-block h-2.5 w-2.5 shrink-0 rounded-full ${colorClass}`
          : `inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 bg-transparent ${colorClass.replace("bg-", "border-")}`
      }
    />
  );
}

type RowDescriptor =
  | { kind: "category"; row: number; roomType: RoomType }
  | { kind: "room"; row: number; room: Room };

/**
 * Desktop-Tape-Chart (Design-Referenz Screen 1). CSS-Grid: Zeilen = Zimmer
 * (gruppiert nach Kategorie), Spalten = Tage. Buchungsbalken über
 * `grid-column: start / span n`, in derselben flachen Grid-Struktur wie die
 * Zimmerzeilen (kein verschachteltes Grid pro Zeile nötig).
 *
 * Kategorie-Filter + Sofortsuche laufen komplett clientseitig über die
 * bereits vom Server geladenen Daten (Auftrag: "kein Server-Roundtrip
 * nötig"). Das Detail-Panel hält seinen Zustand lokal in diesem Client
 * Component (kein URL-Param) — einfacher für V1, da alle Daten ohnehin schon
 * geladen sind.
 */
export function CalendarBoard({
  roomTypes,
  rooms,
  reservations,
  rangeFrom,
  days,
  today,
}: {
  roomTypes: RoomType[];
  rooms: Room[];
  reservations: ReservationWithDetails[];
  rangeFrom: string;
  days: number;
  today: string;
}) {
  const rangeToExclusive = useMemo(() => addDays(rangeFrom, days), [rangeFrom, days]);
  const columns = useMemo(() => Array.from({ length: days }, (_, i) => addDays(rangeFrom, i)), [rangeFrom, days]);

  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(() => new Set(roomTypes.map((rt) => rt.id)));
  const [query, setQuery] = useState("");
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);

  // Nur Reservierungen, die diesen (Desktop-)Zeitraum tatsächlich überschneiden
  // — die Server-Query liefert ggf. mehr (siehe page.tsx: eine gemeinsame
  // Range für Desktop-Gitter + mobile Tagesansicht).
  const reservationsInRange = useMemo(
    () => reservations.filter((r) => r.check_in_date < rangeToExclusive && r.check_out_date > rangeFrom),
    [reservations, rangeFrom, rangeToExclusive]
  );

  const reservationsByRoom = useMemo(() => {
    const map = new Map<string, ReservationWithDetails[]>();
    for (const r of reservationsInRange) {
      if (!r.room_id) continue;
      const list = map.get(r.room_id) ?? [];
      list.push(r);
      map.set(r.room_id, list);
    }
    return map;
  }, [reservationsInRange]);

  const normalizedQuery = query.trim().toLowerCase();

  const visibleRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (!selectedTypeIds.has(room.room_type_id)) return false;
      if (!normalizedQuery) return true;
      if (room.room_number.toLowerCase().includes(normalizedQuery)) return true;
      const roomReservations = reservationsByRoom.get(room.id) ?? [];
      return roomReservations.some((r) => {
        const guestName = r.guest ? `${r.guest.first_name} ${r.guest.last_name}`.toLowerCase() : "";
        return guestName.includes(normalizedQuery) || r.reservation_no.toLowerCase().includes(normalizedQuery);
      });
    });
  }, [rooms, selectedTypeIds, normalizedQuery, reservationsByRoom]);

  const roomsByType = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const room of visibleRooms) {
      const list = map.get(room.room_type_id) ?? [];
      list.push(room);
      map.set(room.room_type_id, list);
    }
    return map;
  }, [visibleRooms]);

  // Auslastung pro Tag: IMMER über alle Zimmer des Hotels (nicht durch den
  // Kategorie-Filter/die Suche beeinflusst) — eine physikalische Kennzahl,
  // kein Artefakt der aktuellen Ansicht.
  const occupancyByDay = useMemo(() => {
    if (rooms.length === 0) return columns.map(() => 0);
    return columns.map((day) => {
      const occupied = reservationsInRange.filter(
        (r) => (r.status === "confirmed" || r.status === "checked_in") && r.check_in_date <= day && day < r.check_out_date
      ).length;
      return Math.round((occupied / rooms.length) * 100);
    });
  }, [columns, reservationsInRange, rooms.length]);

  const todayColIndex = today >= rangeFrom && today < rangeToExclusive ? daysBetween(rangeFrom, today) + 2 : null;

  const rowDescriptors: RowDescriptor[] = [];
  let rowCursor = 2; // Zeile 1 = Datums-Kopfzeile
  for (const roomType of roomTypes) {
    const roomsForType = roomsByType.get(roomType.id);
    if (!roomsForType || roomsForType.length === 0) continue;
    rowDescriptors.push({ kind: "category", row: rowCursor, roomType });
    rowCursor++;
    for (const room of roomsForType) {
      rowDescriptors.push({ kind: "room", row: rowCursor, room });
      rowCursor++;
    }
  }
  const totalRows = Math.max(rowCursor - 1, 1);

  const roomRowIndex = new Map<string, number>();
  for (const d of rowDescriptors) {
    if (d.kind === "room") roomRowIndex.set(d.room.id, d.row);
  }

  const selectedReservation = selectedReservationId
    ? (reservations.find((r) => r.id === selectedReservationId) ?? null)
    : null;
  const selectedRoom = selectedReservation?.room_id
    ? (rooms.find((r) => r.id === selectedReservation.room_id) ?? null)
    : null;

  function toggleType(id: string) {
    setSelectedTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-8">
      <aside className="flex shrink-0 flex-col gap-6 sm:w-56">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2" htmlFor="calendar-search">
            Suche
          </label>
          <input
            id="calendar-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gast, Zimmer oder Buchungsnr."
            className="min-h-11 w-full rounded-md border border-line bg-surface px-3 text-sm text-text focus:border-focus focus:outline-none"
          />
        </div>

        {roomTypes.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-text-2">Kategorien</p>
            <ul className="flex flex-col gap-1">
              {roomTypes.map((rt) => (
                <li key={rt.id}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={selectedTypeIds.has(rt.id)}
                      onChange={() => toggleType(rt.id)}
                      className="h-4 w-4 rounded border-line"
                    />
                    {rt.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-text-2">Legende</p>
          <ul className="flex flex-col gap-1.5 text-xs text-text-2">
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 shrink-0 rounded border-2 border-blue bg-blue-bg" /> Reserviert
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 shrink-0 rounded bg-blue" /> Belegt / In-House
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-3 w-5 shrink-0 rounded border border-line bg-surface-2" /> Abgereist
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-green" /> Zimmer frei
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-yellow" /> Reinigung offen
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-red" /> Wartung / gesperrt
            </li>
          </ul>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface shadow-[var(--shadow-token)]">
        {rooms.length === 0 ? (
          <p className="p-6 text-sm text-text-2">Noch keine Zimmer angelegt.</p>
        ) : visibleRooms.length === 0 ? (
          <p className="p-6 text-sm text-text-2">Keine Zimmer für diese Auswahl — Kategorie-Filter oder Suche prüfen.</p>
        ) : (
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${ROOM_COL_PX}px repeat(${days}, minmax(${DAY_COL_MIN_PX}px, 1fr))`,
              gridTemplateRows: `56px repeat(${totalRows - 1}, auto)`,
            }}
          >
            <div className="sticky left-0 z-10 border-b border-r border-line bg-surface-3" style={{ gridColumn: 1, gridRow: 1 }} />

            {columns.map((day, i) => (
              <div
                key={day}
                className="border-b border-line bg-surface-3 px-2 py-2 text-center"
                style={{ gridColumn: i + 2, gridRow: 1 }}
              >
                <div className="text-xs font-medium text-text-2">
                  {formatWeekdayShort(day)} {formatDate(day)}
                </div>
                <div className="font-mono text-xs text-text-3">{occupancyByDay[i]}%</div>
              </div>
            ))}

            {todayColIndex !== null && (
              <div
                aria-hidden
                className="pointer-events-none border-l-2 border-accent"
                style={{ gridColumn: `${todayColIndex} / span 1`, gridRow: `1 / ${totalRows + 1}` }}
              />
            )}

            {rowDescriptors.map((d) =>
              d.kind === "category" ? (
                <div
                  key={`cat-${d.roomType.id}`}
                  className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold tracking-wide text-text-2 uppercase"
                  style={{ gridColumn: "1 / -1", gridRow: d.row }}
                >
                  {d.roomType.name}
                </div>
              ) : (
                <div
                  key={`room-${d.room.id}`}
                  className="sticky left-0 z-10 flex items-center gap-2 border-r border-b border-line bg-surface-3 px-3 py-2"
                  style={{ gridColumn: 1, gridRow: d.row }}
                >
                  <RoomStatusDot status={d.room.status} />
                  <span className="font-mono text-sm font-semibold text-text">{d.room.room_number}</span>
                  {d.room.floor && <span className="text-xs text-text-3">Etage {d.room.floor}</span>}
                </div>
              )
            )}

            {visibleRooms.flatMap((room) => {
              const rowIndex = roomRowIndex.get(room.id);
              if (!rowIndex) return [];
              const roomReservations = (reservationsByRoom.get(room.id) ?? []).filter((r) => isVisibleOnCalendar(r.status));
              return roomReservations.map((reservation) => {
                const statusKey = reservation.status as keyof typeof RESERVATION_STATUS_META;
                const meta = RESERVATION_STATUS_META[statusKey];
                const clampedStart = reservation.check_in_date < rangeFrom ? rangeFrom : reservation.check_in_date;
                const clampedEndExclusive =
                  reservation.check_out_date > rangeToExclusive ? rangeToExclusive : reservation.check_out_date;
                const startCol = daysBetween(rangeFrom, clampedStart) + 2;
                const span = Math.max(1, daysBetween(clampedStart, clampedEndExclusive));
                const guestName = reservation.guest
                  ? `${reservation.guest.first_name} ${reservation.guest.last_name}`
                  : "Ohne Gast";
                return (
                  <button
                    key={reservation.id}
                    type="button"
                    onClick={() => setSelectedReservationId(reservation.id)}
                    title={`${guestName} · ${meta.label} · ${reservation.reservation_no}`}
                    className={`m-1 truncate rounded px-2 py-1 text-left text-xs font-medium ${meta.barClassName} ${
                      selectedReservationId === reservation.id ? "ring-2 ring-accent" : ""
                    }`}
                    style={{ gridColumn: `${startCol} / span ${span}`, gridRow: rowIndex }}
                  >
                    {guestName}
                  </button>
                );
              });
            })}
          </div>
        )}
      </div>

      {selectedReservation && (
        <ReservationDetailPanel
          reservation={selectedReservation}
          room={selectedRoom}
          onClose={() => setSelectedReservationId(null)}
        />
      )}
    </div>
  );
}
