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
