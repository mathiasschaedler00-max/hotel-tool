import type { PoolClient } from "pg";
import type { WriteContext } from "@modules/_shared/context";

/**
 * `writeAudit()` / `writeAiDecision()` — von `modules/_shared/write.ts`
 * (`executeWrite()`) genutzte Hilfsfunktionen. Beide erwarten eine bereits
 * offene `PoolClient` INNERHALB einer laufenden Transaktion — sie öffnen
 * selbst keine eigene Transaktion, damit Fachwrite + Audit-Insert atomar
 * bleiben (Kern von K5, siehe ARCHITECTURE.md / docs/adr/0002).
 */

export interface WriteAuditParams {
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after: unknown;
}

/** Exakt das Insert-Statement aus dem Architekturplan (Abschnitt "Transaktionaler Write-Pfad"). */
export async function writeAudit(client: PoolClient, ctx: WriteContext, params: WriteAuditParams): Promise<void> {
  await client.query(
    `insert into audit_log (hotel_id, actor_user_id, actor_role, action, module, resource_type, resource_id, old_data, new_data, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      ctx.hotelId,
      ctx.userId,
      ctx.role,
      params.action,
      ctx.module,
      params.resourceType,
      params.resourceId,
      params.before ?? null,
      params.after,
      ctx.requestId,
    ]
  );
}

export interface WriteAiDecisionParams {
  decisionType: string;
  inputContext: Record<string, unknown>;
  model: string;
  modelVersion?: string;
  output: Record<string, unknown>;
  confidence?: number;
  resultingResourceType?: string;
  resultingResourceId?: string;
}

/**
 * Schreibt einen Eintrag in `ai_decision_log`. Noch von keiner Phase-0-Funktion
 * aufgerufen (es gibt noch keine echten KI-Features) — steht bereit für
 * künftige Module (z. B. KI-Rezeption), die eine Entscheidung protokollieren
 * und optional mit einer Fachressource (`tasks.ai_decision_id` u. Ä.) verknüpfen
 * wollen. Gibt die neue `id` zurück, damit der Aufrufer sie z. B. in
 * `tasks.ai_decision_id` referenzieren kann.
 */
export async function writeAiDecision(
  client: PoolClient,
  ctx: Pick<WriteContext, "hotelId" | "module">,
  params: WriteAiDecisionParams
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ai_decision_log (hotel_id, module, decision_type, input_context, model, model_version, output, confidence, resulting_resource_type, resulting_resource_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id`,
    [
      ctx.hotelId,
      ctx.module,
      params.decisionType,
      params.inputContext,
      params.model,
      params.modelVersion ?? null,
      params.output,
      params.confidence ?? null,
      params.resultingResourceType ?? null,
      params.resultingResourceId ?? null,
    ]
  );
  return rows[0].id;
}

/**
 * Markiert eine KI-Entscheidung als manuell angenommen/abgelehnt — z. B. wenn
 * ein Mitarbeiter eine von der KI vorgeschlagene Housekeeping-Aufgabe bestätigt.
 */
export async function acceptAiDecision(
  client: PoolClient,
  id: string,
  acceptedBy: string,
  accepted: boolean
): Promise<void> {
  await client.query(
    `update ai_decision_log set accepted = $2, accepted_by = $3, accepted_at = now() where id = $1`,
    [id, accepted, acceptedBy]
  );
}
