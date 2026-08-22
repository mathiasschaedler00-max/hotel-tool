import type { PgBoss } from "pg-boss";
import { withTransaction } from "@lib/db/pool";
import { createServiceClient } from "@lib/supabase/service";
import { EVENTS, QUEUES } from "@modules/_shared/topics";
import { createSystemContext } from "@modules/_shared/context";
import { writeAudit } from "@modules/audit/service";
import { isModuleEnabled } from "@modules/entitlements/service";

interface BookingCheckedOutPayload {
  reservationId: string;
  hotelId: string;
}

/**
 * Subscribed auf `booking.checked_out` (Publisher: `modules/pms/reservations/service.ts#checkOut`)
 * und erzeugt daraus eine Reinigungsaufgabe. Registriert von `worker/index.ts`.
 */
export async function registerHousekeepingTaskJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.HOUSEKEEPING_ON_BOOKING_CHECKED_OUT);
  await boss.subscribe(EVENTS.BOOKING_CHECKED_OUT, QUEUES.HOUSEKEEPING_ON_BOOKING_CHECKED_OUT);
  await boss.work<BookingCheckedOutPayload>(QUEUES.HOUSEKEEPING_ON_BOOKING_CHECKED_OUT, async ([job]) => {
    await createCleaningTaskForCheckout(job.data);
  });
}

async function createCleaningTaskForCheckout(payload: BookingCheckedOutPayload): Promise<void> {
  const { hotelId, reservationId } = payload;

  // housekeeping könnte für dieses Hotel deaktiviert sein, obwohl pms es
  // nicht ist — dann gibt es hier nichts zu tun (kein Fehler, stiller No-op).
  if (!(await isModuleEnabled(hotelId, "housekeeping"))) return;

  const service = createServiceClient();
  const { data: reservation, error } = await service
    .from("reservations")
    .select("room_id")
    .eq("id", reservationId)
    .eq("hotel_id", hotelId)
    .maybeSingle();

  if (error) {
    console.error("[housekeeping] failed to resolve reservation for checkout task", reservationId, error);
    return;
  }
  if (!reservation?.room_id) {
    // Reservierung ohne zugewiesenes Zimmer (z. B. noch nicht eingecheckt) —
    // TODO: Geschäftsregeln aus Teil A ergänzen (kann das bei einem
    // Check-out überhaupt vorkommen, oder ist das ein Datenfehler?).
    console.warn("[housekeeping] reservation has no room_id, skipping cleaning task", reservationId);
    return;
  }

  const ctx = createSystemContext(hotelId, "housekeeping");
  await withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into tasks (hotel_id, related_type, related_id, title, status, source)
       values ($1, 'room', $2, 'Zimmerreinigung nach Check-out', 'open', 'system')
       returning id`,
      [hotelId, reservation.room_id]
    );
    await writeAudit(client, ctx, {
      action: "housekeeping.task.created_from_checkout",
      resourceType: "task",
      resourceId: rows[0].id,
      after: { reservationId, roomId: reservation.room_id },
    });
  });
}
