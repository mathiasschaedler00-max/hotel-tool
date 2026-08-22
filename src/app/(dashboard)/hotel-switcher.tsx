"use client";

import { useTransition } from "react";
import { switchHotelAction } from "./actions";

interface HotelSummary {
  id: string;
  name: string;
}

/**
 * Hotel-Umschalter für die Dashboard-Navigation. Bei nur einem Hotel (der
 * heutige Regelfall) reicht die reine Namensanzeige — ein Dropdown mit einer
 * Option wäre irreführend (siehe Auftrag). Bei mehreren Hotels ein einfaches
 * `<select>`, das über `switchHotelAction()` den aktiven-Hotel-Cookie setzt.
 */
export function HotelSwitcher({
  hotels,
  activeHotelId,
}: {
  hotels: HotelSummary[];
  activeHotelId: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  if (hotels.length === 0) {
    return <span className="block text-xs text-nav-muted">Kein Hotel gefunden</span>;
  }

  if (hotels.length === 1) {
    return <span className="block truncate text-sm font-medium text-nav-text">{hotels[0].name}</span>;
  }

  return (
    <select
      value={activeHotelId ?? ""}
      disabled={isPending}
      onChange={(e) => {
        const hotelId = e.target.value;
        startTransition(async () => {
          await switchHotelAction(hotelId);
        });
      }}
      aria-label="Aktives Hotel wechseln"
      className="min-h-11 w-full rounded-md border border-nav-2 bg-nav-2 px-2 text-sm text-nav-text disabled:opacity-60"
    >
      {hotels.map((hotel) => (
        <option key={hotel.id} value={hotel.id}>
          {hotel.name}
        </option>
      ))}
    </select>
  );
}
