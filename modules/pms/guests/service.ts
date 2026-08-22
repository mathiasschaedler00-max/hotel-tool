import { randomUUID, randomBytes, createCipheriv } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import type { CreateGuestInput } from "./schema";

/**
 * Öffentlich sichtbare Gast-Spalten. `document_number_encrypted` bewusst NICHT
 * enthalten — weder in Reads noch in `after`/Audit-Log-`new_data` (siehe
 * `createGuest()`), damit das verschlüsselte Bytea nicht unnötig dupliziert
 * oder als komisch-serialisiertes JSON im Audit-Log landet.
 * TODO: autorisierter "Reveal"-Flow (Entschlüsselung für berechtigte Rollen)
 * ist Phase-1-Arbeit, hier nicht Teil von Phase 0.
 */
export interface Guest {
  id: string;
  hotel_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  nationality: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const GUEST_COLUMNS =
  "id, hotel_id, first_name, last_name, email, phone, nationality, created_at, updated_at, deleted_at";

/**
 * Feldebene Verschlüsselung für die Ausweis-/Passnummer (siehe
 * ARCHITECTURE.md Sicherheitsbasis + supabase-Migration `pms_core_domain`).
 *
 * TODO: Geschäftsregeln aus Teil A ergänzen — WELCHE Felder genau verschlüsselt
 * werden müssen ist eine offene Annahme; Schlüssel-Rotation/KMS-Anbindung ist
 * hier bewusst NICHT gelöst. Phase-0-Platzhalter: AES-256-GCM mit einem
 * einzelnen Umgebungs-Secret. Layout: [12 Byte IV][16 Byte Auth-Tag][Ciphertext].
 */
function encryptDocumentNumber(plainText: string): Buffer {
  const raw = process.env.GUEST_DOCUMENT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GUEST_DOCUMENT_ENCRYPTION_KEY ist nicht gesetzt (32 Byte, base64 — siehe .env.local.example)."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GUEST_DOCUMENT_ENCRYPTION_KEY muss nach base64-Dekodierung genau 32 Byte lang sein.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

/** Read: einzelner Gast (ohne die verschlüsselte Ausweisnummer, siehe oben). */
export async function getGuestById(ctx: Pick<ModuleContext, "hotelId">, id: string): Promise<Guest> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const service = createServiceClient();
  const { data, error } = await service
    .from("guests")
    .select(GUEST_COLUMNS)
    .eq("hotel_id", ctx.hotelId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new NotFoundError("guest");
  return data as unknown as Guest;
}

/** Write: neuen Gast anlegen. */
export async function createGuest(ctx: ModuleContext, input: CreateGuestInput): Promise<Guest> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.guests.write");

  const guestId = randomUUID();
  const documentNumberEncrypted = input.documentNumber ? encryptDocumentNumber(input.documentNumber) : null;

  return executeWrite<Guest>(ctx, {
    resourceType: "guest",
    action: "guest.created",
    mutate: async (client) => {
      const { rows } = await client.query<Guest>(
        `insert into guests (id, hotel_id, first_name, last_name, email, phone, nationality, document_number_encrypted)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning ${GUEST_COLUMNS}`,
        [
          guestId,
          ctx.hotelId,
          input.firstName,
          input.lastName,
          input.email ?? null,
          input.phone ?? null,
          input.nationality ?? null,
          documentNumberEncrypted,
        ]
      );
      return { resourceId: guestId, after: rows[0] };
    },
  });
}
