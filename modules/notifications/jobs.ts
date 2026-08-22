import type { PgBoss } from "pg-boss";
import { QUEUES } from "@modules/_shared/topics";
import type { SendEmailInput } from "./schema";

/**
 * Registriert den Worker für `notifications.send-email`. Versand selbst ist
 * NUR ein Platzhalter/TODO — kein echter Mailanbieter (z. B. Resend/Postmark/
 * SES) angebunden. Beweist, dass der Job ankommt und verarbeitet wird.
 */
export async function registerNotificationsJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.NOTIFICATIONS_SEND_EMAIL);
  await boss.work<SendEmailInput>(QUEUES.NOTIFICATIONS_SEND_EMAIL, async ([job]) => {
    // TODO: echten Mailversand anbinden.
    console.info("[notifications] would send email", {
      to: job.data.to,
      subject: job.data.subject,
      template: job.data.template,
    });
  });
}
