import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { ConflictError, NotFoundError } from "@modules/_shared/errors";
import { EVENTS } from "@modules/_shared/topics";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
import { createServiceClient } from "@lib/supabase/service";
import { getPoolForReads } from "@lib/db/pool";
import type { Room } from "@modules/pms/rooms/service";
import type {
  CreateReservationInput,
  CheckOutInput,
  UpdateReservationInput,
  MoveReservationInput,
  CancelReservationInput,
} from "./schema";

/**
 * Postgres-Fehlercode für eine verletzte EXCLUDE-Constraint (siehe Migration
 * `20260823010000_no_double_booking_constraint.sql`). `pg` wirft rohe
 * Fehlerobjekte mit `.code` = SQLSTATE, kein eigener Fehlertyp — deshalb hier
 * ein einfacher Typ-Guard statt `instanceof`. Exportiert, weil
 * `modules/pms/group-bookings/service.ts` denselben Insert-Pfad (und damit
 * dieselbe Fehlerübersetzung) braucht.
 */
export function isExclusionViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "23P01";
}

export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  return Math.round((Date.parse(`${checkOutDate}T00:00:00Z`) - Date.parse(`${checkInDate}T00:00:00Z`)) / 86_400_000);
}

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
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Menschenlesbare, von der UUID getrennte Kennung (K6). Annahme — Teil A prüfen (Format). Exportiert für group-bookings/service.ts. */
export function generateReservationNo(checkInDate: string): string {
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
    case "reservation.updated":
      return "Belegungsdaten geändert";
    case "reservation.moved":
      return "Verschoben";
    case "reservation.cancelled": {
      const reason = newData?.cancel_reason as string | undefined;
      return reason ? `Storniert · ${reason}` : "Storniert";
    }
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
 *
 * `rate_cents`: Vorbelegung aus `room_types.base_rate_cents` × Nächte (Auftrag
 * Schritt 3 — vorher stand hier immer 0, jede Buchung "kostete" nichts), im
 * Formular überschreibbar via `input.rateCents`. Bewusst NUR beim Anlegen
 * berechnet und dann als eigener, unabhängiger Wert gespeichert — eine
 * spätere Preisänderung an der Kategorie darf bestehende Reservierungen
 * NICHT rückwirkend verändern (siehe modules/pms/room-types/service.ts,
 * gleiche Überlegung dort schon für die Kategorien-Verwaltung bestätigt).
 *
 * Überbuchungsschutz: die `no_double_booking`-EXCLUDE-Constraint (Migration
 * `20260823010000_...`) verweigert den Insert hart, wenn `room_id` im
 * gewünschten Zeitraum schon eine `confirmed`/`checked_in`-Reservierung hat —
 * auch bei zwei gleichzeitigen Requests (das kann reine Anwendungslogik
 * nicht garantieren). SQLSTATE 23P01 wird hier in einen lesbaren
 * `ConflictError` (409) übersetzt.
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

      let rateCents = input.rateCents;
      if (rateCents === undefined) {
        const { rows: typeRows } = await client.query<{ base_rate_cents: number }>(
          `select base_rate_cents from room_types where id = $1`,
          [input.roomTypeId]
        );
        const nights = nightsBetween(input.checkInDate, input.checkOutDate);
        rateCents = (typeRows[0]?.base_rate_cents ?? 0) * nights;
      }

      try {
        const { rows } = await client.query<Reservation>(
          `insert into reservations
             (id, hotel_id, reservation_no, group_booking_id, guest_id, room_type_id, room_id,
              check_in_date, check_out_date, status, source, adults, children, rate_cents, notes)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11,$12,$13,$14)
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
            rateCents,
            input.notes ?? null,
          ]
        );
        return { resourceId: reservationId, after: rows[0] };
      } catch (e) {
        if (isExclusionViolation(e)) {
          throw new ConflictError("Zimmer ist im gewählten Zeitraum bereits belegt", {
            roomId: input.roomId,
            checkInDate: input.checkInDate,
            checkOutDate: input.checkOutDate,
          });
        }
        throw e;
      }
    },
    event: {
      topic: EVENTS.RESERVATION_CREATED,
      payload: { reservationId, hotelId: ctx.hotelId },
    },
  });
}

/**
 * Read: freie Zimmer im Zeitraum `[from, to)`, optional auf eine Kategorie
 * eingeschränkt — freundliche Vorabprüfung fürs Buchungsformular, damit die
 * Oberfläche gar nicht erst belegte Zimmer anbietet. Der eigentliche Schutz
 * bleibt die `no_double_booking`-Constraint (siehe `createReservation()`) —
 * diese Funktion ist bewusst nur UX, kein zweiter Durchsetzungsort.
 */
export async function listAvailableRooms(
  ctx: Pick<ModuleContext, "hotelId">,
  from: string,
  to: string,
  roomTypeId?: string
): Promise<Room[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const pool = getPoolForReads();
  const { rows } = await pool.query<Room>(
    `select r.* from rooms r
     where r.hotel_id = $1 and r.deleted_at is null
       and ($2::uuid is null or r.room_type_id = $2)
       and not exists (
         select 1 from reservations res
         where res.room_id = r.id and res.deleted_at is null
           and res.status in ('confirmed', 'checked_in')
           and daterange(res.check_in_date, res.check_out_date, '[)') && daterange($3::date, $4::date, '[)')
       )
     order by r.room_number`,
    [ctx.hotelId, roomTypeId ?? null, from, to]
  );
  return rows;
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

/**
 * Ändert Belegungsdaten (Personenzahl, Notiz, Preis) — bewusst NICHT Zimmer
 * oder Zeitraum, dafür ist `moveReservation()` zuständig. Volles Replace
 * (nicht partial-patch), gleiche Überlegung wie schon bei `updateRoom()`:
 * das Formular schickt immer alle Felder mit.
 */
export async function updateReservation(ctx: ModuleContext, input: UpdateReservationInput): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  return executeWrite<Reservation>(ctx, {
    resourceType: "reservation",
    action: "reservation.updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Reservation>(
        `select * from reservations where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.reservationId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("reservation");

      const { rows } = await client.query<Reservation>(
        `update reservations set adults = $2, children = $3, notes = $4, rate_cents = $5 where id = $1 returning *`,
        [input.reservationId, input.adults, input.children, input.notes, input.rateCents]
      );
      return { resourceId: input.reservationId, before, after: rows[0] };
    },
    event: {
      topic: EVENTS.RESERVATION_UPDATED,
      payload: { reservationId: input.reservationId, hotelId: ctx.hotelId },
    },
  });
}

/**
 * Verschiebt eine Reservierung (Zimmer und/oder Zeitraum) — z. B. per Drag &
 * Drop im Belegungsplan. Beide Felder optional, nur mitschicken was sich
 * ändert. Der eigentliche Schutz ist die `no_double_booking`-Constraint
 * (siehe `createReservation()` für dieselbe SQLSTATE-23P01-Übersetzung) —
 * `roomId: null` erlaubt ausdrücklich das Entfernen der Zimmerzuweisung
 * (Reservierung wird dadurch "nicht zugewiesen", siehe Belegungsplan-Bereich
 * dafür).
 */
export async function moveReservation(ctx: ModuleContext, input: MoveReservationInput): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  return executeWrite<Reservation>(ctx, {
    resourceType: "reservation",
    action: "reservation.moved",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Reservation>(
        `select * from reservations where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.reservationId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("reservation");

      const nextRoomId = input.roomId !== undefined ? input.roomId : before.room_id;
      const nextCheckIn = input.checkInDate ?? before.check_in_date;
      const nextCheckOut = input.checkOutDate ?? before.check_out_date;
      if (nextRoomId) {
        await assertBelongsToHotel(client, ctx.hotelId, "rooms", nextRoomId, "room");
      }

      try {
        const { rows } = await client.query<Reservation>(
          `update reservations set room_id = $2, check_in_date = $3, check_out_date = $4 where id = $1 returning *`,
          [input.reservationId, nextRoomId, nextCheckIn, nextCheckOut]
        );
        return { resourceId: input.reservationId, before, after: rows[0] };
      } catch (e) {
        if (isExclusionViolation(e)) {
          throw new ConflictError("Zimmer ist im gewählten Zeitraum bereits belegt", {
            roomId: nextRoomId,
            checkInDate: nextCheckIn,
            checkOutDate: nextCheckOut,
          });
        }
        throw e;
      }
    },
    event: {
      topic: EVENTS.RESERVATION_MOVED,
      payload: { reservationId: input.reservationId, hotelId: ctx.hotelId },
    },
  });
}

/**
 * Storniert eine Reservierung — mit Grund (Design-Regel §6.5: jede
 * zerstörerische Aktion braucht eine Bestätigung; der Grund gehört zur
 * Nachvollziehbarkeit dazu). Kein Hard-Delete — `status = 'cancelled'` gibt
 * das Zimmer über die `no_double_booking`-Constraint automatisch wieder
 * frei (die filtert explizit auf `status in ('confirmed','checked_in')`).
 */
export async function cancelReservation(ctx: ModuleContext, input: CancelReservationInput): Promise<Reservation> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  return executeWrite<Reservation>(ctx, {
    resourceType: "reservation",
    action: "reservation.cancelled",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Reservation>(
        `select * from reservations where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.reservationId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("reservation");
      if (before.status === "cancelled" || before.status === "checked_out") {
        throw new ConflictError(`Reservierung kann im Status "${before.status}" nicht storniert werden`, {
          currentStatus: before.status,
        });
      }

      const { rows } = await client.query<Reservation>(
        `update reservations set status = 'cancelled', cancel_reason = $2 where id = $1 returning *`,
        [input.reservationId, input.reason]
      );
      return { resourceId: input.reservationId, before, after: rows[0] };
    },
    event: {
      topic: EVENTS.RESERVATION_CANCELLED,
      payload: { reservationId: input.reservationId, hotelId: ctx.hotelId },
    },
  });
}
