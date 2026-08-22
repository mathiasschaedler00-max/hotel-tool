import { Pool, type PoolClient, types } from "pg";

/**
 * Postgres-`date`-Spalten (OID 1082) parst `node-postgres` standardmäßig zu
 * einem JS-`Date`-Objekt (Mitternacht, lokale Zeitzone) — der Rest der
 * Codebasis geht überall von reinen "YYYY-MM-DD"-Strings aus (siehe
 * `lib/format.ts#parseIsoDateUtc`, jede Datums-Arithmetik in den Modulen,
 * `generateReservationNo()`). Deaktiviert diesen Auto-Parser global, damit
 * `date`-Spalten roh als String zurückkommen — konsistent mit dem, was
 * Supabase-JS/PostgREST für Reads ohnehin liefert (das serialisiert
 * `date`-Spalten nativ als String, nie als Objekt).
 *
 * Gefunden über `scripts/verify-phase1/04-reservation-lifecycle.ts`:
 * `moveReservation()`/`createGroupBooking()` gaben `check_in_date` als
 * `Date`-Objekt zurück, worauf `generateReservationNo()` mit
 * `TypeError: checkInDate.replaceAll is not a function` abstürzte — bis
 * jetzt unbemerkt, weil noch keine Oberfläche das Rückgabeobjekt eines
 * raw-pg-Schreibpfads direkt weiterverarbeitet hat.
 */
types.setTypeParser(1082, (value) => value);

/**
 * Roher `pg`-Pool über den Supabase Transaction-Pooler (Supavisor, Port 6543).
 *
 * Der Supabase-JS-Client kann pro Request nur einen einzelnen PostgREST-Call
 * absetzen, keine Mehrschritt-Transaktion. Für den transaktionalen Write-Pfad
 * (`modules/_shared/write.ts`, Kern von K5: Fachwrite + Audit-Insert +
 * Event-Insert + pg-boss-Enqueue müssen atomar sein) brauchen wir deshalb
 * eine echte `BEGIN … COMMIT`-Transaktion auf einer einzigen Connection.
 *
 * `DATABASE_URL` muss auf den Transaction-Pooler zeigen (Port 6543,
 * `?pgbouncer=true` je nach Supabase-Doku zum Implementierungszeitpunkt —
 * siehe docs/adr/0002-transactional-write-path.md).
 */
let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL ist nicht gesetzt — Transaction-Pooler-Connection-String erwartet (siehe .env.local.example)."
      );
    }
    pool = new Pool({ connectionString, max: 10 });
    pool.on("error", (err) => {
      // Verhindert, dass ein Fehler auf einer idle Connection den Prozess crasht.
      console.error("[db-pool] unexpected error on idle client", err);
    });
  }
  return pool;
}

/**
 * Führt `fn` innerhalb einer einzigen `BEGIN … COMMIT`/`ROLLBACK`-Transaktion
 * auf einer dedizierten `PoolClient`-Connection aus.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError) => {
      console.error("[db-pool] rollback failed", rollbackError);
    });
    throw error;
  } finally {
    client.release();
  }
}

/** Für Fälle außerhalb einer Transaktion (z. B. einfache Reads aus Jobs). */
export function getPoolForReads(): Pool {
  return getPool();
}
