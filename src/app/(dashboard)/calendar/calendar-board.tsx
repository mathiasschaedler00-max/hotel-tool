"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatWeekdayShort } from "@lib/format";
import type { Room } from "@modules/pms/rooms/service";
import type { RoomType } from "@modules/pms/room-types/service";
import type { ReservationWithDetails } from "@modules/pms/reservations/service";
import { getRoomDisplayStatus, type RoomStatus } from "../rooms/room-status";
import { RESERVATION_STATUS_META, isVisibleOnCalendar } from "./reservation-status";
import { ReservationDetailPanel } from "./reservation-detail-panel";

const ROOM_COL_PX = 168;
const DAY_COL_MIN_PX = 68;
const DAY_COL_COMPACT_PX = 28;
const MAX_DESKTOP_DAYS = 90;
// Ab hier ("Zeitraum wählen" mit mehr als der größten Schnellwahl 31T)
// bekämen Gästenamen im Balken ohnehin keinen brauchbaren Platz mehr — dann
// automatisch auf reine Farbbalken ohne Text umschalten (Auftrag 22.08.2026).
const COMPACT_THRESHOLD_DAYS = 31;

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

const ALLOWED_DAYS = [7, 14, 31] as const;

/**
 * Rein visueller Kapazitäts-Indikator (nicht in der Design-Referenz
 * vorgegeben, aber sinnvolle Ergänzung zur reinen %-Zahl). Andere
 * Bedeutung als die Statusfarben-Tabelle §2 (dort: Zimmer-/Buchungsstatus)
 * — hier: reine Auslastungs-Kapazität, eigener Kontext, siehe §2 "Farbe =
 * eindeutig eine Bedeutung PRO KONTEXT".
 */
function occupancyColorClass(pct: number): string {
  if (pct >= 80) return "bg-red";
  if (pct >= 50) return "bg-yellow";
  return "bg-green";
}

/** Gleiche Farb-/Label-Zuordnung wie `room-list.tsx#StatusDot` (aus `room-status.ts` importiert, nicht neu definiert). */
function RoomStatusDot({ status, isCheckedInToday }: { status: RoomStatus; isCheckedInToday: boolean }) {
  const meta = getRoomDisplayStatus(status, isCheckedInToday);
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
  rangeWasClamped = false,
}: {
  roomTypes: RoomType[];
  rooms: Room[];
  reservations: ReservationWithDetails[];
  rangeFrom: string;
  days: number;
  today: string;
  rangeWasClamped?: boolean;
}) {
  const rangeToExclusive = useMemo(() => addDays(rangeFrom, days), [rangeFrom, days]);
  const rangeToInclusive = useMemo(() => addDays(rangeFrom, days - 1), [rangeFrom, days]);
  const columns = useMemo(() => Array.from({ length: days }, (_, i) => addDays(rangeFrom, i)), [rangeFrom, days]);
  const isCompact = days > COMPACT_THRESHOLD_DAYS;
  const dayColPx = isCompact ? DAY_COL_COMPACT_PX : DAY_COL_MIN_PX;

  const [selectedTypeIds, setSelectedTypeIds] = useState<Set<string>>(() => new Set(roomTypes.map((rt) => rt.id)));
  const [query, setQuery] = useState("");
  const [selectedReservationId, setSelectedReservationId] = useState<string | null>(null);

  // "Zeitraum wählen"-Popover: bleibt als natives <details> ohne JS
  // funktionsfähig (GET-Formular), schließt sich zusätzlich bei Klick
  // daneben/Escape — sonst liegt es unbegrenzt über dem Gitter (Review-Fund,
  // 22.08.2026: "verdeckt die Anzeige mit den anderen Sachen").
  const rangePickerRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (rangePickerRef.current?.open && !rangePickerRef.current.contains(e.target as Node)) {
        rangePickerRef.current.open = false;
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && rangePickerRef.current) {
        rangePickerRef.current.open = false;
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

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

  // Für den Zimmer-Punkt: "Belegt" (blau) ist rein abgeleitet, siehe
  // room-status.ts#getRoomDisplayStatus — nutzt bewusst `reservations` (die
  // volle, ungefilterte Liste), nicht `reservationsInRange` (auf den
  // sichtbaren Zeitraum zugeschnitten), damit der Punkt auch dann noch
  // stimmt, wenn gerade eine andere Woche/ein anderer Monat angezeigt wird.
  // Bekannte Grenze: liegt "heute" außerhalb dessen, was `listReservationsInRange()`
  // serverseitig überhaupt geladen hat (Vereinigung aus Desktop-Fenster +
  // mobilem Einzeltag, siehe page.tsx), fehlt der Punkt trotzdem — kein
  // eigener "immer heute mitladen"-Query gebaut, um den Umfang klein zu halten.
  const checkedInTodayRoomIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of reservations) {
      if (r.status === "checked_in" && r.room_id && r.check_in_date <= today && today < r.check_out_date) {
        ids.add(r.room_id);
      }
    }
    return ids;
  }, [reservations, today]);

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

  // Navigation: Vor/Zurück verschiebt um `days` (den aktuellen Fenster-
  // Umfang), "Heute" behält den gewählten Umfang bei und setzt nur das
  // Datum zurück. Linkbasiert (wie schon die mobile Tagesliste in
  // `day-list.tsx`) statt Client-State — ein echter Server-Roundtrip mit
  // frisch geladenen Daten, kein Re-Fetch nötig.
  const prevFrom = addDays(rangeFrom, -days);
  const nextFrom = addDays(rangeFrom, days);

  const roomCountByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const room of rooms) {
      map.set(room.room_type_id, (map.get(room.room_type_id) ?? 0) + 1);
    }
    return map;
  }, [rooms]);

  return (
    <div className="flex h-full flex-col gap-3 p-4 sm:p-6">
      {/* Eine gemeinsame Werkzeugleiste (Datum-Navigation, Zeitraum-Umschalter,
       * Sofortsuche, "Neue Buchung") statt Suche separat in der Sidebar —
       * so wie im echten Prototyp (docs/design/hotel-os-prototype-source.html,
       * <header>-Block), nach Review korrigiert. */}
      <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        {/* Zeitraum wird oben angezeigt (Auftrag 22.08.2026) — gilt für
         * Schnellwahl UND frei gewählten Zeitraum gleichermaßen, da beide
         * intern auf dasselbe rangeFrom+days-Modell abgebildet werden. */}
        <span className="font-mono text-sm font-medium text-text">
          {formatDate(rangeFrom)} – {formatDate(rangeToInclusive)}
        </span>

        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5">
          <Link
            href={`/calendar?from=${prevFrom}&days=${days}`}
            aria-label="Zeitraum zurück"
            className="flex min-h-8 min-w-8 items-center justify-center rounded text-text hover:bg-surface"
          >
            ←
          </Link>
          <Link
            href={`/calendar?from=${today}&days=${days}`}
            className="flex min-h-8 items-center justify-center rounded px-3 text-xs font-medium text-text hover:bg-surface"
          >
            Heute
          </Link>
          <Link
            href={`/calendar?from=${nextFrom}&days=${days}`}
            aria-label="Zeitraum vor"
            className="flex min-h-8 min-w-8 items-center justify-center rounded text-text hover:bg-surface"
          >
            →
          </Link>
        </div>
        <div className="flex items-center gap-0.5 rounded-md bg-surface-2 p-0.5 text-xs">
          {ALLOWED_DAYS.map((d) => (
            <Link
              key={d}
              href={`/calendar?from=${rangeFrom}&days=${d}`}
              className={`flex min-h-8 items-center justify-center rounded px-3 ${
                d === days ? "bg-accent text-on-accent" : "text-text-2 hover:bg-surface"
              }`}
            >
              {d}T
            </Link>
          ))}
        </div>

        {/* "Zeitraum wählen": Von–Bis-Auswahl für gezielte Zeiträume (z. B.
         * 1.–20. Dezember), ohne sich per Pfeil dorthin klicken zu müssen.
         * Als <details>-Popover mit reinem GET-Formular gebaut — braucht kein
         * Client-JS, landet direkt in den URL-Suchparametern (`from`/`to`),
         * genau wie die übrigen Zeitraum-Steuerelemente hier. */}
        <details ref={rangePickerRef} className="relative text-xs">
          <summary className="flex min-h-8 list-none items-center justify-center rounded-md bg-surface-2 px-3 text-text-2 hover:bg-surface [&::-webkit-details-marker]:hidden">
            Zeitraum wählen
          </summary>
          <form
            method="GET"
            action="/calendar"
            className="absolute top-full left-0 z-40 mt-1 flex w-64 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-[var(--shadow-token)]"
          >
            <label className="flex flex-col gap-1 text-text-2">
              Von
              <input
                type="date"
                name="from"
                defaultValue={rangeFrom}
                required
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-text-2">
              Bis
              <input
                type="date"
                name="to"
                defaultValue={rangeToInclusive}
                required
                className="min-h-9 rounded-md border border-line bg-surface-3 px-2 text-text focus:border-focus focus:outline-none"
              />
            </label>
            <p className="text-[11px] text-text-3">Max. {MAX_DESKTOP_DAYS} Tage — längere Auswahl wird gekürzt.</p>
            <button
              type="submit"
              className="min-h-9 rounded-md bg-accent px-3 font-semibold text-on-accent hover:bg-accent-hi"
            >
              Anwenden
            </button>
          </form>
        </details>

        <div className="flex-1" />

        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-text-3">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gast, Zimmer oder Buchungsnr. …"
            aria-label="Suche"
            className="min-h-9 w-56 rounded-md border border-line bg-surface-3 py-1.5 pr-3 pl-7 text-xs text-text focus:border-focus focus:outline-none"
          />
        </div>

        {/* "Neue Buchung" existiert im Prototyp als Werkzeugleisten-Button —
         * hier bewusst NICHT verkabelt: das manuelle Anlegen von Reservierungen
         * ist explizit Schritt 3, nicht Schritt 2. Optisch schon an der
         * richtigen Stelle, damit die Werkzeugleiste beim Schritt-3-Umbau
         * nicht nochmal umgebaut werden muss. */}
        <button
          type="button"
          disabled
          title="Reservierungen manuell anlegen kommt in Schritt 3"
          className="min-h-9 cursor-not-allowed rounded-md bg-accent px-3 text-xs font-semibold text-on-accent opacity-50"
        >
          Neue Buchung
        </button>
      </div>

      {rangeWasClamped && (
        <p className="text-xs text-text-2">
          Der gewählte Zeitraum war länger als {MAX_DESKTOP_DAYS} Tage und wurde auf {MAX_DESKTOP_DAYS} Tage gekürzt.
        </p>
      )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
      <aside className="flex shrink-0 flex-col gap-5 overflow-y-auto sm:w-52">
        {roomTypes.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] font-medium tracking-wide text-text-3 uppercase">Kategorien</p>
            <ul className="flex flex-col gap-0.5">
              {roomTypes.map((rt) => (
                <li key={rt.id}>
                  <label className="flex min-h-8 cursor-pointer items-center gap-2 text-xs text-text">
                    <input
                      type="checkbox"
                      checked={selectedTypeIds.has(rt.id)}
                      onChange={() => toggleType(rt.id)}
                      className="h-3.5 w-3.5 rounded border-line"
                    />
                    <span className="flex-1">{rt.name}</span>
                    <span className="font-mono text-[11px] text-text-3">{roomCountByType.get(rt.id) ?? 0}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[10px] font-medium tracking-wide text-text-3 uppercase">Legende</p>
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
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-blue" /> Zimmer belegt (abgeleitet)
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

      {/* `flex-1 min-h-0` statt einer festen `max-h-[Xvh]`-Schätzung (Review-
       * Fund, 22.08.2026: eine vh-basierte Höhe war je nach Fenstergröße
       * unzuverlässig und hat das Gitter teils zu früh abgeschnitten). Füllt
       * exakt die verbleibende Höhe der Flex-Zeile — dafür muss der ganze
       * Eltern-Baum bis zum `<body>` durchgängig `h-full`/`min-h-0` sein
       * (siehe layout.tsx-Dateien). `overflow-y-auto` macht diesen
       * Container zum eigenen Scroll-Viewport, erst dadurch kann
       * `sticky top-0` auf der Datums-Kopfzeile unten etwas bewirken. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto rounded-lg border border-line bg-surface shadow-[var(--shadow-token)]">
        {rooms.length === 0 ? (
          <p className="p-6 text-sm text-text-2">Noch keine Zimmer angelegt.</p>
        ) : visibleRooms.length === 0 ? (
          <p className="p-6 text-sm text-text-2">Keine Zimmer für diese Auswahl — Kategorie-Filter oder Suche prüfen.</p>
        ) : (
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `${ROOM_COL_PX}px repeat(${days}, minmax(${dayColPx}px, 1fr))`,
              gridTemplateRows: `64px repeat(${totalRows - 1}, auto)`,
            }}
          >
            {/* Ecke oben-links: sticky in BEIDEN Achsen (höchster z-index, da
             * Schnittpunkt von Zimmerspalte + Datums-Kopfzeile). */}
            <div className="sticky top-0 left-0 z-30 border-b border-r border-line bg-surface-3" style={{ gridColumn: 1, gridRow: 1 }} />

            {columns.map((day, i) => (
              <div
                key={day}
                title={`${formatWeekdayShort(day)} ${formatDate(day)} · ${occupancyByDay[i]}% belegt`}
                className={`sticky top-0 z-20 border-b border-line bg-surface-3 text-center ${
                  isCompact ? "px-0.5 py-2" : "px-2 py-2"
                }`}
                style={{ gridColumn: i + 2, gridRow: 1 }}
              >
                {isCompact ? (
                  <div className="font-mono text-[10px] text-text-2">{day.slice(8, 10)}</div>
                ) : (
                  <>
                    <div className="text-xs font-medium text-text-2">
                      {formatWeekdayShort(day)} {formatDate(day)}
                    </div>
                    <div className="font-mono text-xs text-text-3">{occupancyByDay[i]}%</div>
                  </>
                )}
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div
                    className={`h-full rounded-full ${occupancyColorClass(occupancyByDay[i])}`}
                    style={{ width: `${occupancyByDay[i]}%` }}
                  />
                </div>
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
                // Die Zeile selbst spannt bewusst die volle Gitterbreite (Band
                // bleibt beim horizontalen Scrollen durchgängig sichtbar) —
                // nur das Label bekommt zusätzlich sein eigenes `sticky
                // left-0`, sonst wandert der Text mit der linken Kante DIESES
                // Divs (die bei Spalte 1 liegt) aus dem sichtbaren Bereich,
                // sobald man über die Zimmerspalte hinausscrollt (Review-Fund,
                // 22.08.2026).
                <div
                  key={`cat-${d.roomType.id}`}
                  className="border-b border-line bg-surface-2 py-1"
                  style={{ gridColumn: "1 / -1", gridRow: d.row }}
                >
                  <div className="sticky left-0 z-10 w-fit px-3 text-xs font-semibold tracking-wide text-text-2 uppercase">
                    {d.roomType.name}
                  </div>
                </div>
              ) : (
                <div
                  key={`room-${d.room.id}`}
                  className="sticky left-0 z-10 flex items-center gap-2 border-r border-b border-line bg-surface-3 px-3 py-1"
                  style={{ gridColumn: 1, gridRow: d.row }}
                >
                  <RoomStatusDot status={d.room.status} isCheckedInToday={checkedInTodayRoomIds.has(d.room.id)} />
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
                const nights = daysBetween(reservation.check_in_date, reservation.check_out_date);
                const barLabel = `${guestName} · ${meta.label} · ${reservation.reservation_no}`;
                return (
                  <button
                    key={reservation.id}
                    type="button"
                    onClick={() => setSelectedReservationId(reservation.id)}
                    aria-label={barLabel}
                    title={isCompact ? barLabel : undefined}
                    className={`m-1 block w-full min-w-0 truncate rounded text-left text-xs font-medium ${meta.barClassName} ${
                      isCompact ? "px-1 py-1" : "px-2 py-1"
                    } ${selectedReservationId === reservation.id ? "ring-2 ring-accent" : ""}`}
                    style={{ gridColumn: `${startCol} / span ${span}`, gridRow: rowIndex }}
                  >
                    {/* Ab COMPACT_THRESHOLD_DAYS reine Farbbalken ohne Text (Auftrag
                     * 22.08.2026, Punkt 3) — Name bleibt über aria-label/title und
                     * Klick auf den Balken (Detail-Panel) weiter zugänglich. */}
                    {!isCompact && (
                      <>
                        {guestName} · {nights}N
                      </>
                    )}
                  </button>
                );
              });
            })}
          </div>
        )}
      </div>

      {/* Als Seitenpanel RECHTS neben dem Gitter (Design-Referenz §5, Screen
       * 1/2), nicht darunter — sonst verliert man beim Scrollen den Bezug
       * zur angeklickten Buchung (Review-Fund, 22.08.2026). Eigenes
       * `overflow-y-auto` im Panel selbst, falls der Inhalt (Verlauf) länger
       * wird als die Zeilenhöhe (Flex-Stretch macht es gleich hoch wie das
       * Gitter daneben). */}
      {selectedReservation && (
        <ReservationDetailPanel
          key={selectedReservation.id}
          reservation={selectedReservation}
          room={selectedRoom}
          onClose={() => setSelectedReservationId(null)}
        />
      )}
      </div>
    </div>
  );
}
