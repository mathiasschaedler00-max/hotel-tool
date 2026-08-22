import { z } from "zod";

export const sendEmailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  /** Annahme — Teil A prüfen: Template-Key statt fertigem HTML, echtes Templating ist Phase-1-Arbeit. */
  template: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
