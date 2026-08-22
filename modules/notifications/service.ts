import { sendJob } from "@lib/queue/boss";
import { QUEUES } from "@modules/_shared/topics";
import { sendEmailSchema, type SendEmailInput } from "./schema";

/**
 * Reiht eine transaktionale Mail als pg-boss-Queue-Job ein. Der eigentliche
 * Versand ist Aufgabe von `jobs.ts` (dort aktuell nur ein Platzhalter/TODO —
 * kein echter Mailanbieter angebunden).
 *
 * Bewusst NICHT über `executeWrite()` — eine Mail ist keine auditierbare
 * Fachressource mit before/after-Zustand, sondern ein Fire-and-forget-Job.
 * Wo eine Mail Konsequenz eines Fachwrites ist (z. B. Buchungsbestätigung),
 * ruft die jeweilige Modul-Funktion `enqueueEmail()` zusätzlich zu ihrem
 * eigenen `executeWrite()`-Aufruf auf.
 */
export async function enqueueEmail(input: SendEmailInput): Promise<string | null> {
  const parsed = sendEmailSchema.parse(input);
  return sendJob(QUEUES.NOTIFICATIONS_SEND_EMAIL, parsed);
}
