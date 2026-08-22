import { PgBoss, type Db as PgBossDb, type SendOptions } from "pg-boss";
import type { PoolClient } from "pg";
import type { EventTopic, QueueName } from "@modules/_shared/topics";

/**
 * pg-boss-Singleton pro Prozess (Next.js-Web-Prozess UND `worker/index.ts`
 * laufen jeweils mit ihrer eigenen Instanz, siehe ADR 0003).
 *
 * Verbindung über den Session-Pooler (Port 5432, `DATABASE_URL_SESSION`) —
 * Portnummern/Poolernamen bei Supabase zum Implementierungszeitpunkt gegen
 * die dann aktuelle Doku prüfen (`supabase`-Skill konsultieren).
 */
let bossInstance: PgBoss | undefined;
let startPromise: Promise<PgBoss> | undefined;

function buildBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL_SESSION;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL_SESSION ist nicht gesetzt — Session-Pooler-Connection-String erwartet (siehe .env.local.example)."
    );
  }
  const instance = new PgBoss({ connectionString });
  instance.on("error", (err) => console.error("[pg-boss]", err));
  return instance;
}

/**
 * Liefert die gestartete pg-boss-Instanz (lazy, idempotent — `start()` wird
 * pro Prozess nur einmal aufgerufen, egal wie oft `getBoss()` parallel
 * aufgerufen wird). `start()` legt bei Bedarf das `pgboss`-Schema an.
 */
export async function getBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (!startPromise) {
    startPromise = (async () => {
      const instance = buildBoss();
      await instance.start();
      bossInstance = instance;
      return instance;
    })();
  }
  return startPromise;
}

/**
 * Adaptiert eine offene `pg`-`PoolClient` (innerhalb einer laufenden
 * Transaktion, siehe `lib/db/pool.ts#withTransaction`) auf das von pg-boss
 * erwartete `IDatabase`-Interface, sodass `boss.publish(...)` sein Insert
 * über dieselbe Connection/Transaktion ausführt statt über den eigenen Pool.
 * Das ist die konkrete Umsetzung von "Event-Insert + pg-boss-Enqueue atomar
 * in einer Transaktion" (Kern von K5, siehe modules/_shared/write.ts).
 */
export function pgBossDbAdapter(client: PoolClient): PgBossDb {
  return {
    async executeSql(text: string, values?: unknown[]) {
      return client.query(text, values as unknown[] | undefined);
    },
  };
}

/** Queue-Job einreihen (`boss.send`), typisiert auf die Registry aus `topics.ts`. */
export async function sendJob(
  queue: QueueName,
  data: Record<string, unknown>,
  options?: SendOptions
): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queue, data, options);
}

/**
 * Event veröffentlichen (`boss.publish`). Wird normalerweise NICHT direkt
 * aufgerufen, sondern über `executeWrite()`'s `event`-Option (atomar mit dem
 * Fachwrite) — dieser Export existiert für Fälle außerhalb eines Writes
 * (z. B. rein informative Events) und für `pgBossDbAdapter`-Aufrufe von außen.
 */
export async function publishEvent(
  topic: EventTopic,
  payload: Record<string, unknown>,
  options?: SendOptions
): Promise<void> {
  const boss = await getBoss();
  await boss.publish(topic, payload, options);
}

/** Registriert eine Queue als Abonnent eines Events (Fan-out, siehe topics.ts). */
export async function subscribeQueueToEvent(topic: EventTopic, queue: QueueName): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(queue); // `ON CONFLICT DO NOTHING` in pg-boss selbst — idempotent
  await boss.subscribe(topic, queue);
}

/** Erzeugt eine Queue, falls sie noch nicht existiert (idempotent, s.o.). */
export async function ensureQueue(queue: QueueName): Promise<void> {
  const boss = await getBoss();
  await boss.createQueue(queue);
}
