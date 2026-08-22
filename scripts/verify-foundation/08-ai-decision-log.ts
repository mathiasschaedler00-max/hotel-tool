/**
 * Punkt 8 der Abnahme: KI-Entscheidungslog.
 *
 * Dummy-Eintrag in `ai_decision_log` (decision_type =
 * 'housekeeping.task_suggestion') ueber die echte `writeAiDecision()`-
 * Hilfsfunktion anlegen, per `ai_decision_id` mit einer neuen `tasks`-Zeile
 * verknuepfen, danach `accepted`/`accepted_by` ueber die echte
 * `acceptAiDecision()`-Funktion aktualisieren (simuliert "Annehmen" durch
 * einen Mitarbeiter) — und die Verknuepfung in der DB nachweisen.
 */
import { withTransaction } from "@lib/db/pool";
import { writeAiDecision, acceptAiDecision } from "@modules/audit/service";
import { rawPool, record, assertTrue } from "./_lib";
import type { Fixtures } from "./01-setup";

export async function testAiDecisionLog(fixtures: Fixtures): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  const pool = rawPool();

  const { aiDecisionId, taskId } = await withTransaction(async (client) => {
    const aiDecisionId = await writeAiDecision(
      client,
      { hotelId: fixtures.hotelA.id, module: "housekeeping" },
      {
        decisionType: "housekeeping.task_suggestion",
        inputContext: { reason: "Abnahmetest Punkt 8", roomId: fixtures.hotelA.roomId },
        model: "dummy-model",
        modelVersion: "v0-test",
        output: { suggestedTitle: "Zimmerreinigung (KI-Vorschlag, Abnahmetest)" },
        confidence: 0.87,
        resultingResourceType: "task",
      }
    );

    const { rows } = await client.query<{ id: string }>(
      `insert into tasks (hotel_id, related_type, related_id, title, status, source, ai_decision_id)
       values ($1,'room',$2,$3,'open','ai',$4) returning id`,
      [fixtures.hotelA.id, fixtures.hotelA.roomId, "KI-Vorschlag: Zimmerreinigung (Abnahmetest)", aiDecisionId]
    );
    return { aiDecisionId, taskId: rows[0].id };
  });
  details.push(`ai_decision_log-Eintrag angelegt (id=${aiDecisionId}), tasks-Zeile angelegt (id=${taskId}, ai_decision_id gesetzt).`);

  // Simuliert "Annehmen" durch einen Mitarbeiter (front_office-a von Hotel A).
  await withTransaction(async (client) => {
    await acceptAiDecision(client, aiDecisionId, fixtures.hotelA.frontOffice.id, true);
  });
  details.push(`acceptAiDecision() aufgerufen (accepted=true, accepted_by=front_office-a).`);

  const { rows: decisionRows } = await pool.query(
    `select accepted, accepted_by, accepted_at from ai_decision_log where id = $1`,
    [aiDecisionId]
  );
  const decision = decisionRows[0];
  const decisionOk =
    decision?.accepted === true &&
    decision?.accepted_by === fixtures.hotelA.frontOffice.id &&
    decision?.accepted_at !== null;
  if (!decisionOk) {
    allOk = false;
    details.push(`FEHLER: ai_decision_log-Zeile nach acceptAiDecision() nicht korrekt: ${JSON.stringify(decision)}`);
  } else {
    details.push(`ai_decision_log: accepted=true, accepted_by korrekt, accepted_at gesetzt.`);
  }

  const { rows: taskRows } = await pool.query(`select ai_decision_id from tasks where id = $1`, [taskId]);
  const linkOk = taskRows[0]?.ai_decision_id === aiDecisionId;
  if (!linkOk) {
    allOk = false;
    details.push(`FEHLER: tasks.ai_decision_id (${taskRows[0]?.ai_decision_id}) verweist nicht auf ${aiDecisionId}.`);
  } else {
    details.push(`Verknuepfung bestaetigt: tasks.ai_decision_id === ai_decision_log.id (${aiDecisionId}).`);
  }

  record(8, "KI-Entscheidungslog (ai_decision_log <-> tasks, Annehmen simuliert)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "KI-Entscheidungslog");
}
