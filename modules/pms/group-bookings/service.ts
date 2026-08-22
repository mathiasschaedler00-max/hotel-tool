import { randomUUID } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { ConflictError } from "@modules/_shared/errors";
import { EVENTS } from "@modules/_shared/topics";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { assertBelongsToHotel } from "@modules/_shared/tenant-guard";
import {
  isExclusionViolation,
  nightsBetween,
  generateReservationNo,
  type Reservation,
} from "@modules/pms/reservations/service";
import type { CreateGroupBookingInput } from "./schema";

export interface GroupBooking {
  id: string;
  hotel_id: string;
  name: string;
  contact_guest_id: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Legt eine Gruppenbuchung an: die Gruppe selbst + alle mitgelieferten
 * Reservierungen in EINER Transaktion — entweder geht die ganze Gruppe
 * durch, oder keine Zeile (Auftrag Schritt 3: "das Anlegen mehrerer
 * Reservierungen in einem Zug"). Reserviert deshalb bewusst NICHT
 * `createReservation()` mehrfach nacheinander auf.
 *
 * Jede einzelne Reservierung durchläuft denselben Überbuchungsschutz wie
 * `createReservation()` (dieselbe `no_double_booking`-Constraint, dieselbe
 * SQLSTATE-23P01-Übersetzung) — kollidiert auch nur ein Zimmer der Gruppe
 * mit einer Bestandsbuchung, rollt die komplette Gruppe zurück.
 *
 * Audit-Log bekommt EINEN Eintrag für die Gruppe als Ganzes (Aktion
 * `group_booking.created`) — die einzelnen Reservierungszeilen sind Teil
 * derselben logischen Schreiboperation, kein separates `reservation.created`
 * pro Zimmer (anders als bei einer einzeln über `createReservation()`
 * angelegten Buchung).
 */
export async function createGroupBooking(
  ctx: ModuleContext,
  input: CreateGroupBookingInput
): Promise<{ group: GroupBooking; reservations: Reservation[] }> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.reservations.write");

  const groupId = randomUUID();
  const createdReservations: Reservation[] = [];

  const group = await executeWrite<GroupBooking>(ctx, {
    resourceType: "group_booking",
    action: "group_booking.created",
    mutate: async (client) => {
      if (input.contactGuestId) {
        await assertBelongsToHotel(client, ctx.hotelId, "guests", input.contactGuestId, "guest");
      }

      const { rows: groupRows } = await client.query<GroupBooking>(
        `insert into group_bookings (id, hotel_id, name, contact_guest_id, check_in_date, check_out_date)
         values ($1,$2,$3,$4,$5,$6)
         returning *`,
        [
          groupId,
          ctx.hotelId,
          input.name,
          input.contactGuestId ?? null,
          input.checkInDate ?? null,
          input.checkOutDate ?? null,
        ]
      );

      for (const resInput of input.reservations) {
        await assertBelongsToHotel(client, ctx.hotelId, "guests", resInput.guestId, "guest");
        await assertBelongsToHotel(client, ctx.hotelId, "room_types", resInput.roomTypeId, "room_type");
        if (resInput.roomId) {
          await assertBelongsToHotel(client, ctx.hotelId, "rooms", resInput.roomId, "room");
        }

        let rateCents = resInput.rateCents;
        if (rateCents === undefined) {
          const { rows: typeRows } = await client.query<{ base_rate_cents: number }>(
            `select base_rate_cents from room_types where id = $1`,
            [resInput.roomTypeId]
          );
          const nights = nightsBetween(resInput.checkInDate, resInput.checkOutDate);
          rateCents = (typeRows[0]?.base_rate_cents ?? 0) * nights;
        }

        const reservationId = randomUUID();
        const reservationNo = generateReservationNo(resInput.checkInDate);

        try {
          const { rows } = await client.query<Reservation>(
            `insert into reservations
               (id, hotel_id, reservation_no, group_booking_id, guest_id, room_type_id, room_id,
                check_in_date, check_out_date, status, source, adults, children, rate_cents, notes)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed','direct',$10,$11,$12,$13)
             returning *`,
            [
              reservationId,
              ctx.hotelId,
              reservationNo,
              groupId,
              resInput.guestId,
              resInput.roomTypeId,
              resInput.roomId ?? null,
              resInput.checkInDate,
              resInput.checkOutDate,
              resInput.adults,
              resInput.children,
              rateCents,
              resInput.notes ?? null,
            ]
          );
          createdReservations.push(rows[0]);
        } catch (e) {
          if (isExclusionViolation(e)) {
            throw new ConflictError(
              `Zimmer für ${resInput.checkInDate}–${resInput.checkOutDate} ist bereits belegt — ganze Gruppe wurde nicht angelegt`,
              { roomId: resInput.roomId, checkInDate: resInput.checkInDate, checkOutDate: resInput.checkOutDate }
            );
          }
          throw e;
        }
      }

      return { resourceId: groupId, after: groupRows[0] };
    },
    event: {
      topic: EVENTS.GROUP_BOOKING_CREATED,
      payload: { groupId, hotelId: ctx.hotelId, reservationCount: input.reservations.length },
    },
  });

  return { group, reservations: createdReservations };
}
