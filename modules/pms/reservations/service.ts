import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { ConflictError, NotFoundError } from "@modules/_shared/errors";
import { EVENTS } from "@modules/_shared/topics";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
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

const RESERVATION_SOURCE_LABELS: Record<string, string> = {
  direct: "Direktbuchung",
  channel_manager: "Kanal-Sync",
  phone: "Telefon",
  walk_in: "Walk-in",
};

/** Menschenlesbarer Text pro `audit_log`-Eintrag. Unbekannte Aktionen fallen auf den rohen Aktionsnamen zurück. */
function describeAuditAction(action: string, newData: Record<string, unknown> | null): string {
  switch (action) {
    case "reservation.created": {
      const source = newData?.source as string | undefined;
      const label = source ? (RESERVATION_SOURCE_LABELS[source] ?? source) : undefined;
      return label ? `Buchung eingegangen · ${label}` : "Buchung eingegangen";
    }
    case "reservation.checked_out":
      return "Check-out";
    default:
      return action;
  }
}

export interface ReservationHistoryEntry {
  action: string;
  description: string;
  createdAt: string;
}

/**
 * Read: Verlauf einer Reservierung aus dem echten `audit_log` (jeder
 * Schreibpfad über `executeWrite()` protokolliert dort automatisch,
 * siehe `modules/_shared/write.ts`) — keine separate Verlaufs-Tabelle,
 * keine erfundenen Einträge. Aktuell meist nur "Buchung eingegangen",
 * da Check-in/Verschieben/Stornieren erst Schritt 3/4 sind.
 */
export async function getReservationHistory(
  ctx: Pick<ModuleContext, "hotelId">,
  reservationId: string
): Promise<ReservationHistoryEntry[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("audit_log")
    .select("action, new_data, created_at")
    .eq("hotel_id", ctx.hotelId)
    .eq("resource_type", "reservation")
    .eq("resource_id", reservationId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    action: row.action as string,
    description: describeAuditAction(row.action as string, row.new_data as Record<string, unknown> | null),
    createdAt: row.created_at as string,
  }));
}

/** Reservierung inkl. Gastname und Zimmer — Ergebnisform von `listReservationsInRange()`. */
export interface ReservationWithDetails extends Reservation {
  guest: { first_name: string; last_name: string } | null;
  room: { room_number: string; floor: string | null } | null;
}

/**
 * Read: Reservierungen, deren Zeitraum `[check_in_date, check_out_date)` den
 * angefragten Bereich `[from, to)` überschneidet — inkl. Gastname (Join auf
 * `guests`) und Zimmer (Join auf `rooms`), ein Query statt N+1. Datenquelle
 * für den Belegungsplan (Phase 1, Schritt 2).
 *
 * Konsistent mit `listRooms()` (`modules/pms/rooms/service.ts`): reiner Read,
 * daher nur `assertModuleEnabled()`, kein `requirePermission()`.
 *
 * Überlappungs-Bedingung für zwei halboffene Intervalle: `check_in_date < to`
 * UND `check_out_date > from` (Standard-Intervall-Überschneidungstest).
 */
export async function listReservationsInRange(
  ctx: Pick<ModuleContext, "hotelId">,
  from: string,
  to: string
): Promise<ReservationWithDetails[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("reservations")
    .select("*, guest:guests(first_name,last_name), room:rooms(room_number,floor)")
    .eq("hotel_id", ctx.hotelId)
    .is("deleted_at", null)
    .lt("check_in_date", to)
    .gt("check_out_date", from)
    .order("check_in_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ReservationWithDetails[];
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
      // `modules/_shared/tenant-guard.ts#assertBelongsToHotel()`) — VOR dem
      // Insert, innerhalb derselben Transaktion, damit ein Fehlschlag hier
      // den gesamten Write rollbackt.
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
