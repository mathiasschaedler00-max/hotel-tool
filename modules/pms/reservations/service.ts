import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { ConflictError, NotFoundError } from "@modules/_shared/errors";
import { EVENTS } from "@modules/_shared/topics";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { CreateReservationInput, CheckOutInput } from "./schema";

export interface Reservation {
  id: string;
  hotel_id: string;
  reservation_no: string;
  group_booking_id: string | null;
  guest_id: string;
  room_type_id: string;
  room_id: string | null;
  check_in_date: string;
  check_out_date: string;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
  source: "direct" | "channel_manager" | "phone" | "walk_in";
  adults: number;
  children: number;
  rate_cents: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Menschenlesbare, von der UUID getrennte Kennung (K6). Annahme — Teil A prüfen (Format). */
function generateReservationNo(checkInDate: string): string {
  const compact = checkInDate.replaceAll("-", "");
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return `RES-${compact}-${suffix}`;
}

/** Read: einzelne Reservierung (RLS-geschützt über den Service-Client-Filter auf hotel_id). */
export async function getReservationById(ctx: Pick<ModuleContext, "hotelId">, id: string): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("reservations")
    .select("*")
    .eq("hotel_id", ctx.hotelId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new NotFoundError("reservation");
  return data as Reservation;
}

/**
 * Prueft, dass eine referenzierte Ressource (guest/room_type/room) wirklich
 * zu `hotelId` gehoert, BEVOR sie in eine neue Reservierung uebernommen wird.
 *
 * Bugfix (gefunden im Phase-0-Abnahmetest, Punkt 2 "Mandantentrennung"):
 * `createReservation()` hat `input.guestId`/`input.roomTypeId`/`input.roomId`
 * bisher ungeprueft in die Insert-Values uebernommen. `ctx.hotelId` bestimmt
 * zwar den `hotel_id`-Wert der neuen Reservierung selbst, aber nichts hat
 * verhindert, dass ein Aufrufer mit gueltigem Hotel-A-Kontext eine Guest-/
 * RoomType-/Room-ID referenziert, die tatsaechlich zu Hotel B gehoert — eine
 * cross-tenant Referenz, die die zweite Verteidigungslinie (Vorgabe #2,
 * RBAC/Modul-Ebene) haette abfangen muessen, aber nicht abgefangen hat.
 * Wirft `NotFoundError` (nicht `ForbiddenError`) — aus Sicht von `ctx.hotelId`
 * existiert die Ressource schlicht nicht, analog zu `getReservationById()` &
 * Co., die dieselbe Semantik fuer nicht zum Hotel gehoerende IDs verwenden.
 */
async function assertBelongsToHotel(
  client: PoolClient,
  hotelId: string,
  table: "guests" | "room_types" | "rooms",
  id: string,
  resourceLabel: string
): Promise<void> {
  const { rows } = await client.query(
    `select 1 from ${table} where id = $1 and hotel_id = $2 and deleted_at is null`,
    [id, hotelId]
  );
  if (rows.length === 0) throw new NotFoundError(resourceLabel);
}

/**
 * Legt eine neue Reservierung an (1 Reservation = 1 Room-Stay).
 * Muster: assertModuleEnabled → requirePermission → executeWrite.
 * Publiziert `reservation.created` (aktuell ohne Subscriber, siehe topics.ts).
 */
export async function createReservation(ctx: ModuleContext, input: CreateReservationInput): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  // Client-generierbare UUID VOR dem Insert (K6, Offline-Sync-Constraint #1) —
  // dadurch kann `resourceId` schon in `event.payload` verwendet werden, ohne
  // dass `executeWrite()` seine Signatur ändern müsste.
  const reservationId = randomUUID();
  const reservationNo = generateReservationNo(input.checkInDate);

  return executeWrite<Reservation>(ctx, {
    resourceType: "reservation",
    action: "reservation.created",
    mutate: async (client) => {
      // Hotel-Zugehoerigkeit der referenzierten Ressourcen pruefen (siehe
      // `assertBelongsToHotel()` oben) — VOR dem Insert, innerhalb derselben
      // Transaktion, damit ein Fehlschlag hier den gesamten Write rollbackt.
      await assertBelongsToHotel(client, ctx.hotelId, "guests", input.guestId, "guest");
      await assertBelongsToHotel(client, ctx.hotelId, "room_types", input.roomTypeId, "room_type");
      if (input.roomId) {
        await assertBelongsToHotel(client, ctx.hotelId, "rooms", input.roomId, "room");
      }

      const { rows } = await client.query<Reservation>(
        `insert into reservations
           (id, hotel_id, reservation_no, group_booking_id, guest_id, room_type_id, room_id,
            check_in_date, check_out_date, status, source, adults, children, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13)
         returning *`,
        [
          reservationId,
          ctx.hotelId,
          reservationNo,
          input.groupBookingId ?? null,
          input.guestId,
          input.roomTypeId,
          input.roomId ?? null,
          input.checkInDate,
          input.checkOutDate,
          input.source,
          input.adults,
          input.children,
          input.notes ?? null,
        ]
      );
      return { resourceId: reservationId, after: rows[0] };
    },
    event: {
      topic: EVENTS.RESERVATION_CREATED,
      payload: { reservationId, hotelId: ctx.hotelId },
    },
  });
}

/**
 * Checkt eine Reservierung aus. Publiziert `booking.checked_out` — Subscriber:
 * `modules/housekeeping/tasks/jobs.ts` erzeugt daraus eine Reinigungsaufgabe.
 */
export async function checkOut(ctx: ModuleContext, input: CheckOutInput): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  return executeWrite<Reservation>(ctx, {
    resourceType: "reservation",
    action: "reservation.checked_out",
    mutate: async (client) => {
      const { rows: existingRows } = await client.query<Reservation>(
        `select * from reservations where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.reservationId, ctx.hotelId]
      );
      const before = existingRows[0];
      if (!before) throw new NotFoundError("reservation");
      if (before.status !== "checked_in") {
        throw new ConflictError(
          `Reservation must be checked_in to check out (current status: ${before.status})`,
          { currentStatus: before.status }
        );
      }

      const { rows } = await client.query<Reservation>(
        `update reservations set status = 'checked_out' where id = $1 returning *`,
        [input.reservationId]
      );
      return { resourceId: input.reservationId, before, after: rows[0] };
    },
    event: {
      topic: EVENTS.BOOKING_CHECKED_OUT,
      payload: { reservationId: input.reservationId, hotelId: ctx.hotelId },
    },
  });
}
