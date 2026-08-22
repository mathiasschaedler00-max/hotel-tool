/**
 * Zentrale Formatier-Helfer für Geld (Cent-Integer → EUR) und Datum (de-AT).
 *
 * Alle Beträge liegen in der DB als `*_cents`-Integer (richtig so, keine
 * Fließkomma-Rundungsfehler) — bis jetzt fehlte ein zentraler Helfer, um sie
 * konsistent anzuzeigen. Design-Regel (docs/design/hotel-tool-design-
 * referenz.md §6.4): Beträge nie kommentarlos weglassen, lieber "0,00 €"
 * grau anzeigen — dafür sorgt der Aufrufer per CSS-Klasse, nicht diese
 * Funktion (die formatiert immer, auch für 0).
 */

const euroFormatter = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

/** Cent-Integer → formatierter EUR-Betrag, z. B. `12000` → "120,00 €". */
export function formatEuro(cents: number): string {
  return euroFormatter.format(cents / 100);
}

const dateFormatter = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short" });
const weekdayFormatter = new Intl.DateTimeFormat("de-AT", { weekday: "short" });

/** Parst ein ISO-Datum (`YYYY-MM-DD`) als UTC-Mitternacht, damit die lokale
 * Zeitzone die Anzeige nie um einen Tag verschiebt (reine Kalenderdaten ohne
 * Uhrzeit-Anteil, wie `reservations.check_in_date`/`check_out_date`). */
function parseIsoDateUtc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** ISO-Datum (`YYYY-MM-DD`) → kurzes de-AT-Format, z. B. "3. Sep". */
export function formatDate(iso: string): string {
  return dateFormatter.format(parseIsoDateUtc(iso));
}

/** ISO-Datum (`YYYY-MM-DD`) → kurzer Wochentag, z. B. "Mo" — für Kalender-Spaltenköpfe. */
export function formatWeekdayShort(iso: string): string {
  return weekdayFormatter.format(parseIsoDateUtc(iso));
}

const dateTimeFormatter = new Intl.DateTimeFormat("de-AT", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Echter Zeitstempel (`timestamptz`, z. B. `audit_log.created_at`) → de-AT,
 * z. B. "22. Aug., 18:51". Bewusst OHNE `parseIsoDateUtc()` — der Trick dort
 * ist nur für reine Kalenderdaten ohne Uhrzeit nötig (sonst verschiebt die
 * lokale Zeitzone den Tag); ein echter Zeitstempel hat seine Zeitzone schon.
 */
export function formatDateTime(isoTimestamp: string): string {
  return dateTimeFormatter.format(new Date(isoTimestamp));
}
