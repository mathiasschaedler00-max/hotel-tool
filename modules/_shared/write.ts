import type { PoolClient } from "pg";
import { withTransaction } from "@lib/db/pool";
import { getBoss, pgBossDbAdapter } from "@lib/queue/boss";
import { writeAudit } from "@modules/audit/service";
import type { WriteContext } from "./context";
import type { EventTopic } from "./topics";

export interface ExecuteWriteOptions<T> {
  resourceType: string;
  action: string;
  mutate: (client: PoolClient) => Promise<{ resourceId: string; before?: unknown; after: T }>;
  event?: { topic: EventTopic; payload: Record<string, unknown> };
}

/**
 * Transaktionaler Write+Audit+Event-Helper — Herzstück von K5.
 *
 * Fachwrite (`opts.mutate`) + Audit-Insert (`writeAudit`) + Event-Insert +
 * pg-boss-Publish laufen in EINER Transaktion über den rohen `pg`-Pool
 * (`lib/db/pool.ts`, Transaction-Pooler), nicht über den Supabase-JS-Client
 * (der kann pro Request nur einen einzelnen PostgREST-Call, keine
 * Mehrschritt-Transaktion). Bricht `opts.mutate` oder einer der Inserts,
 * rollt die komplette Transaktion zurück — es kann nie einen Fachwrite ohne
 * Audit-Eintrag geben (Vorgabe #2, siehe docs/adr/0002).
 *
 * Autorisierung (`assertModuleEnabled()` + `requirePermission()`) passiert
 * VOR dem Aufruf von `executeWrite()`, innerhalb der Modul-Service-Funktion
 * — hier drin wird bewusst nicht erneut geprüft.
 */
export async function executeWrite<T>(ctx: WriteContext, opts: ExecuteWriteOptions<T>): Promise<T> {
  return withTransaction(async (client) => {
    const { resourceId, before, after } = await opts.mutate(client);

    await writeAudit(client, ctx, {
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId,
      before,
      after,
    });

    if (opts.event) {
      await client.query(
        `insert into events (hotel_id, event_type, aggregate_type, aggregate_id, payload, created_by) values ($1,$2,$3,$4,$5,$6)`,
        [ctx.hotelId, opts.event.topic, opts.resourceType, resourceId, opts.event.payload, ctx.userId]
      );

      // In derselben Transaktion einreihen (siehe lib/queue/boss.ts#pgBossDbAdapter).
      // Hinweis (aus dem Plan übernommen): pg-boss-API zum Einreihen innerhalb
      // einer bestehenden Transaktion zum Implementierungszeitpunkt gegen die
      // dann aktuelle pg-boss-Doku verifizieren — für pg-boss 12.27.0 verifiziert
      // über node_modules/pg-boss/dist/types.d.ts: `SendOptions.db?: IDatabase`
      // wird von `publish()` durchgereicht und ersetzt die interne Connection.
      const boss = await getBoss();
      await boss.publish(opts.event.topic, opts.event.payload, { db: pgBossDbAdapter(client) });
    }

    return after;
  });
}
