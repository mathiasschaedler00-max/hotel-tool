import { randomUUID, randomBytes, createCipheriv } from "node:crypto";
import type { ModuleContext } from "@modules/_shared/context";
import { executeWrite } from "@modules/_shared/write";
import { NotFoundError } from "@modules/_shared/errors";
import { assertModuleEnabled } from "@modules/entitlements/service";
import { requirePermission } from "@modules/rbac/permissions";
import { createServiceClient } from "@lib/supabase/service";
import { getPoolForReads } from "@lib/db/pool";
import type { CreateGuestInput, UpdateGuestInput } from "./schema";

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

/**
 * Read: Gastsuche für die Buchungsstrecke (Auftrag Schritt 3 — ohne
 * Gastsuche ist keine Buchung am Empfang möglich). Über den rohen Pool
 * statt Supabase-JS `.or()`, damit die Suchbegriffe sauber parametrisiert
 * bleiben (kein PostgREST-Filter-String-Interpolation-Risiko).
 */
export async function searchGuests(ctx: Pick<ModuleContext, "hotelId">, query: string): Promise<Guest[]> {
  await assertModuleEnabled(ctx.hotelId, "pms");

  const pool = getPoolForReads();
  const pattern = `%${query}%`;
  const { rows } = await pool.query<Guest>(
    `select ${GUEST_COLUMNS} from guests
     where hotel_id = $1 and deleted_at is null
       and (
         first_name ilike $2 or last_name ilike $2 or email ilike $2
         or (first_name || ' ' || last_name) ilike $2
       )
     order by last_name, first_name
     limit 20`,
    [ctx.hotelId, pattern]
  );
  return rows;
}

/** Write: Gast-Stammdaten ändern (Name/Kontakt) — nicht die Ausweisnummer, dafür ist der separate Reveal-Flow (TODO oben) zuständig. */
export async function updateGuest(ctx: ModuleContext, input: UpdateGuestInput): Promise<Guest> {
  await assertModuleEnabled(ctx.hotelId, "pms");
  requirePermission(ctx, "pms.guests.write");

  return executeWrite<Guest>(ctx, {
    resourceType: "guest",
    action: "guest.updated",
    mutate: async (client) => {
      const { rows: beforeRows } = await client.query<Guest>(
        `select ${GUEST_COLUMNS} from guests where id = $1 and hotel_id = $2 and deleted_at is null for update`,
        [input.guestId, ctx.hotelId]
      );
      const before = beforeRows[0];
      if (!before) throw new NotFoundError("guest");

      // `document_number_encrypted` bewusst nur setzen, wenn eine neue Nummer
      // mitkommt — ohne Reveal-Flow kann sie nicht gelesen und damit auch
      // nicht als Teil eines Voll-Replace zurückgeschrieben werden.
      const { rows } = input.documentNumber
        ? await client.query<Guest>(
            `update guests set first_name = $2, last_name = $3, email = $4, phone = $5, nationality = $6,
                    document_number_encrypted = $7
             where id = $1 returning ${GUEST_COLUMNS}`,
            [
              input.guestId,
              input.firstName,
              input.lastName,
              input.email,
              input.phone,
              input.nationality,
              encryptDocumentNumber(input.documentNumber),
            ]
          )
        : await client.query<Guest>(
            `update guests set first_name = $2, last_name = $3, email = $4, phone = $5, nationality = $6
             where id = $1 returning ${GUEST_COLUMNS}`,
            [input.guestId, input.firstName, input.lastName, input.email, input.phone, input.nationality]
          );
      return { resourceId: input.guestId, before, after: rows[0] };
    },
  });
}
