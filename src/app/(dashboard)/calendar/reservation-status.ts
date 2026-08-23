/**
 * Reservierungsstatus → Balkendarstellung im Belegungsplan, gemäß
 * docs/design/hotel-tool-design-referenz.md §2: `checked_in` = Blau gefüllt,
 * `confirmed` = Blau umrandet/hell, `checked_out` = gedämpft/grau.
 * `cancelled`/`no_show` werden laut Design NICHT als Balken gerendert (siehe
 * `isVisibleOnCalendar()`).
 *
 * Eigenständig von `../rooms/room-status.ts` (das ist der ZIMMER-Status, 6
 * Werte, `rooms.status`) — hier geht es um den REERVIERUNGS-Status auf dem
 * Buchungsbalken (`reservations.status`, 5 Werte), ein anderes Datenmodell-Feld.
 */
export const RESERVATION_STATUS_META: Record<
  "confirmed" | "checked_in" | "checked_out",
  { label: string; barClassName: string }
> = {
  confirmed: { label: "Reserviert", barClassName: "border-2 border-blue bg-blue-bg text-blue" },
  checked_in: { label: "In-House", barClassName: "bg-blue text-white" },
  checked_out: { label: "Abgereist", barClassName: "border border-line bg-surface-2 text-text-3" },
};

const VISIBLE_ON_CALENDAR = new Set(["confirmed", "checked_in", "checked_out"]);

/** Bearbeiten/Verschieben/Stornieren/Drag&Drop nur bei aktiven Buchungen — geteilt zwischen Detail-Panel und Belegungsplan. */
export const EDITABLE_RESERVATION_STATUSES = new Set(["confirmed", "checked_in"]);

/** cancelled/no_show werden laut Design-Referenz §2 im Belegungsplan nicht als Balken gerendert. */
export function isVisibleOnCalendar(status: string): boolean {
  return VISIBLE_ON_CALENDAR.has(status);
}

/** Labels für ALLE Reservierungsstatus (auch die ausgeblendeten) — fürs Detail-Panel/die Tagesliste. */
export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  confirmed: "Reserviert",
  checked_in: "In-House",
  checked_out: "Abgereist",
  cancelled: "Storniert",
  no_show: "No-Show",
};
