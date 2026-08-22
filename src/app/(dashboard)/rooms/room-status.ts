/**
 * Zimmerstatus → Farbe/Label — nur noch die vier echten Housekeeping-/
 * Betriebszustände (Korrektur nach Review, siehe Migration
 * `20260822210000_room_status_only_housekeeping_states.sql`). "Reserviert"/
 * "Belegt" sind bewusst KEIN Zimmerstatus mehr, sondern leiten sich aus
 * `reservations.status` ab (Buchungsbalken im Belegungsplan, siehe
 * `reservation-status.ts`) — daher hier auch keine Blau-Töne mehr, Blau
 * bleibt ausschließlich dem Buchungsstatus vorbehalten (§2 "eine Farbe =
 * eine Bedeutung pro Kontext").
 */
export const ROOM_STATUS_META = {
  available: { label: "Frei", color: "green", filled: true },
  cleaning: { label: "Reinigung", color: "yellow", filled: true },
  maintenance: { label: "Wartung", color: "red", filled: true },
  blocked: { label: "Gesperrt", color: "red", filled: false },
} as const;

export type RoomStatus = keyof typeof ROOM_STATUS_META;

export const ROOM_STATUS_ORDER: RoomStatus[] = ["available", "cleaning", "maintenance", "blocked"];

export interface RoomDisplayStatus {
  label: string;
  color: "green" | "blue" | "yellow" | "red";
  filled: boolean;
}

/**
 * "Belegt" (blau) für den Zimmer-Punkt — Mathias, 22.08.2026: rein zur
 * Anzeigezeit abgeleitet, NIE in `rooms.status` gespeichert (das bleibt
 * strikt bei den vier Werten oben). Wird nur hier verwendet, taucht
 * bewusst NICHT in `ROOM_STATUS_META`/`ROOM_STATUS_ORDER` auf (die bilden
 * exakt den DB-Wertebereich + das Dropdown ab).
 */
const OCCUPIED_DISPLAY: RoomDisplayStatus = { label: "Belegt", color: "blue", filled: true };

/**
 * Priorität bei Konflikt (Mathias, 22.08.2026): Wartung/gesperrt (rot) >
 * Reinigung (gold) > belegt (blau, abgeleitet) > frei (grün) — ein
 * Problemzustand darf nie von einer Belegung überdeckt werden.
 */
export function getRoomDisplayStatus(roomStatus: RoomStatus, isCheckedInToday: boolean): RoomDisplayStatus {
  if (roomStatus === "maintenance" || roomStatus === "blocked" || roomStatus === "cleaning") {
    return ROOM_STATUS_META[roomStatus];
  }
  if (isCheckedInToday) return OCCUPIED_DISPLAY;
  return ROOM_STATUS_META.available;
}
