import Link from "next/link";
import { getActiveHotelId, getUserHotels } from "@lib/hotel-context";
import { HotelSwitcher } from "./hotel-switcher";

/**
 * App-Shell für alle eingeloggten Dashboard-Seiten (Phase 1, Schritt 2 —
 * Querschnitt "App-Shell / Navigation"). Next.js Route Group `(dashboard)`:
 * ändert nur die Ordnerstruktur, nicht die URL — `/rooms` bleibt `/rooms`,
 * `/calendar` ist neu.
 *
 * Seitennavigation im dunklen `--nav`/`--nav-2`-Ton laut Design (Tokens
 * existieren schon in globals.css). Hotel-Umschalter nutzt das vorhandene
 * `getUserHotels()`/`setActiveHotelId()` — bei nur einem Hotel wird nur der
 * Name gezeigt (kein Dropdown nötig). Kein Logout in V1 (siehe Auftrag).
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [hotels, activeHotelId] = await Promise.all([getUserHotels(), getActiveHotelId()]);

  return (
    <div className="flex min-h-full flex-1 flex-col sm:flex-row">
      <nav className="flex shrink-0 flex-col gap-4 bg-nav px-4 py-4 sm:w-56 sm:px-3 sm:py-6">
        <div className="px-1">
          <span className="text-sm font-semibold tracking-wide text-nav-text">Hotel Tool</span>
        </div>

        <div className="px-1">
          <HotelSwitcher hotels={hotels} activeHotelId={activeHotelId} />
        </div>

        <ul className="flex flex-row gap-1 sm:flex-col">
          <li className="flex-1 sm:flex-none">
            <Link
              href="/rooms"
              className="block min-h-11 rounded-md px-3 py-2 text-sm font-medium text-nav-muted hover:bg-nav-2 hover:text-nav-text"
            >
              Zimmer
            </Link>
          </li>
          <li className="flex-1 sm:flex-none">
            <Link
              href="/calendar"
              className="block min-h-11 rounded-md px-3 py-2 text-sm font-medium text-nav-muted hover:bg-nav-2 hover:text-nav-text"
            >
              Belegungsplan
            </Link>
          </li>
        </ul>
      </nav>

      <main className="min-h-full flex-1 bg-bg">{children}</main>
    </div>
  );
}
