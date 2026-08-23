/**
 * Zentrale Registry aller pg-boss-Namen (Event-Topics + Queues).
 *
 * pg-boss deckt zwei Rollen ab:
 * - Queue (`boss.send`/`boss.work`): direkte Background-Jobs, ein Producer,
 *   ein Consumer, gleicher Name für Queue == Job-Typ.
 * - Pub/Sub (`boss.publish`/`boss.subscribe`): Event-Bus (K3). Ein Publisher
 *   veröffentlicht unter einem Event-Namen; beliebig viele Queues können sich
 *   unabhängig voneinander auf dieses Event registrieren (Fan-out), ohne dass
 *   der Publisher sie kennt — "CheckOut passiert → System kann reagieren".
 *
 * Alle Publisher/Subscriber importieren ausschließlich aus dieser Datei,
 * damit Namen nicht auseinanderlaufen.
 */

/** Event-Namen für `boss.publish()` / `boss.subscribe()`. */
export const EVENTS = {
  /** Publisher: modules/pms/reservations/service.ts (checkOut()). */
  BOOKING_CHECKED_OUT: "booking.checked_out",
  /** Aktuell kein Subscriber — reserviert für spätere Verwendung (z. B. Channel-Manager-Sync). */
  RESERVATION_CREATED: "reservation.created",
  /** Publisher: modules/pms/reservations/service.ts. Gleiche Einordnung wie ROOM_*: kein Subscriber nötig, Audit-Log deckt Historie ab. */
  RESERVATION_UPDATED: "reservation.updated",
  RESERVATION_MOVED: "reservation.moved",
  RESERVATION_CANCELLED: "reservation.cancelled",
  /** Publisher: modules/pms/group-bookings/service.ts (createGroupBooking()). */
  GROUP_BOOKING_CREATED: "group_booking.created",
  /**
   * Publisher: modules/pms/rooms/service.ts (createRoom()/updateRoom()/
   * deactivateRoom()). Aktuell kein Subscriber — das Audit-Log deckt die
   * Historie bereits automatisch ab (jeder `executeWrite()`-Aufruf schreibt
   * unabhängig vom `event`-Feld einen Audit-Eintrag); diese Events sind für
   * künftige Hintergrund-Reaktionen reserviert (z. B. Channel-Manager-Sync
   * bei Stammdatenänderung), nicht für die Aktualität von Belegungsplan/
   * Zimmerverwaltung selbst — beide lesen bei jedem Seitenaufruf direkt aus
   * derselben `rooms`-Tabelle, dafür ist kein Event nötig.
   */
  ROOM_CREATED: "room.created",
  ROOM_UPDATED: "room.updated",
  ROOM_DEACTIVATED: "room.deactivated",
  ROOM_REACTIVATED: "room.reactivated",
  /** Publisher: modules/pms/room-types/service.ts (createRoomType()/updateRoomType()). Gleiche Einordnung wie ROOM_*. */
  ROOM_TYPE_CREATED: "room_type.created",
  ROOM_TYPE_UPDATED: "room_type.updated",
  ROOM_TYPE_DEACTIVATED: "room_type.deactivated",
  ROOM_TYPE_REACTIVATED: "room_type.reactivated",
} as const;

export type EventTopic = (typeof EVENTS)[keyof typeof EVENTS];

/** Queue-Namen für `boss.send()` / `boss.work()` (inkl. der Fan-out-Queues von Subscribern). */
export const QUEUES = {
  /** Direkte Queue, Producer: modules/notifications/service.ts (enqueueEmail()). */
  NOTIFICATIONS_SEND_EMAIL: "notifications.send-email",
  /** Scheduled (cron pro Hotel, Europe/Vienna) — siehe worker/index.ts. */
  PMS_NIGHT_AUDIT_RUN_FOR_HOTEL: "pms.night-audit.run-for-hotel",
  /** Subscriber-Queue für EVENTS.BOOKING_CHECKED_OUT, siehe modules/housekeeping/tasks/jobs.ts. */
  HOUSEKEEPING_ON_BOOKING_CHECKED_OUT: "housekeeping.on-booking-checked-out",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
