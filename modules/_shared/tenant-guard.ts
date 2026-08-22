import type { PoolClient } from "pg";
import { NotFoundError } from "./errors";

/**
 * Prüft, dass eine referenzierte Ressource (guest/room_type/room/reservation/
 * folio) wirklich zu `hotelId` gehört, BEVOR sie in einen neuen Datensatz
 * übernommen wird — wird innerhalb einer laufenden Transaktion aufgerufen,
 * damit ein Fehlschlag hier den gesamten Write rollbackt.
 *
 * Verschoben aus `modules/pms/reservations/service.ts` (dort ursprünglich
 * privat, nur für `createReservation()` gebaut) hierher, damit auch
 * `modules/pms/folios/service.ts#openFolio()` und
 * `modules/pms/payments/service.ts#recordPayment()` dieselbe Prüfung nutzen
 * können.
 *
 * ⚠️ Sicherheitsrelevanter Fix (Phase 1, Schritt 2, siehe
 * /Users/mathias/.claude/plans/teil-b-die-staged-codd.md, Tabelle
 * "Ausgangslage: was in der Modul-Schicht wirklich fehlt"):
 * `openFolio()` und `recordPayment()` haben ihre Fremdschlüssel (`reservationId`/
 * `guestId` bzw. `folioId`/`reservationId`) bisher UNGEPRÜFT übernommen —
 * exakt dieselbe Cross-Tenant-Lücke, die im Phase-0-Abnahmetest für
 * `reservations` gefunden und gefixt wurde (`ctx.hotelId` bestimmt zwar den
 * `hotel_id`-Wert des neuen Datensatzes selbst, aber nichts hat verhindert,
 * dass ein gültiger Hotel-A-Kontext eine tatsächlich zu Hotel B gehörende ID
 * referenziert). Jetzt in beiden Modulen ebenfalls eingesetzt.
 *
 * Wirft `NotFoundError` (nicht `ForbiddenError`) — aus Sicht von `hotelId`
 * existiert die Ressource schlicht nicht, analog zu `getReservationById()`
 * & Co., die dieselbe Semantik für nicht zum Hotel gehörende IDs verwenden.
 */
export async function assertBelongsToHotel(
  client: PoolClient,
  hotelId: string,
  table: "guests" | "room_types" | "rooms" | "reservations" | "folios",
  id: string,
  resourceLabel: string
): Promise<void> {
  const { rows } = await client.query(
    `select 1 from ${table} where id = $1 and hotel_id = $2 and deleted_at is null`,
    [id, hotelId]
  );
  if (rows.length === 0) throw new NotFoundError(resourceLabel);
}
