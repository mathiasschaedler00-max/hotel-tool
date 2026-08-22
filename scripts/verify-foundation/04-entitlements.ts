/**
 * Punkt 4 der Abnahme: Entitlement-Check.
 *
 * `pms`-Modul fuer Hotel B deaktivieren, danach eine `pms`-Funktion fuer
 * Hotel B aufrufen -> muss `ModuleDisabledError` werfen. Zusaetzlich isoliert
 * testen, dass `modules/_shared/response.ts#err()` das korrekt auf HTTP 404
 * mapt UND den `moduleKey` (Details) NICHT an den Client durchreicht
 * (404-Hiding, siehe docs/adr/0004).
 *
 * Am Ende wird `pms` fuer Hotel B wieder aktiviert (sauberer Endzustand fuer
 * beide Test-Hotels, siehe Bericht).
 */
import { randomUUID } from "node:crypto";
import { rawPool, record, assertTrue } from "./_lib";
import type { Fixtures } from "./01-setup";
import { getReservationById } from "@modules/pms/reservations/service";
import { ModuleDisabledError } from "@modules/_shared/errors";
import { err } from "@modules/_shared/response";

export async function testEntitlements(fixtures: Fixtures): Promise<void> {
  const details: string[] = [];
  let allOk = true;
  const pool = rawPool();

  await pool.query(`update hotel_modules set enabled = false where hotel_id = $1 and module_key = 'pms'`, [
    fixtures.hotelB.id,
  ]);
  details.push(`hotel_modules.enabled = false fuer Hotel B / 'pms' gesetzt.`);

  let disabledRejected = false;
  let errInfo = "";
  try {
    await getReservationById({ hotelId: fixtures.hotelB.id }, randomUUID());
    errInfo = "Kein Fehler geworfen!";
  } catch (e) {
    disabledRejected = e instanceof ModuleDisabledError;
    errInfo = e instanceof Error ? `${e.constructor.name}: ${e.message} (status=${(e as ModuleDisabledError).status})` : String(e);
  }
  if (!disabledRejected) {
    allOk = false;
    details.push(`FEHLER: getReservationById() fuer Hotel B (pms deaktiviert) wurde NICHT mit ModuleDisabledError verweigert. ${errInfo}`);
  } else {
    details.push(`Modul-Ebene: getReservationById() fuer Hotel B wirft korrekt ModuleDisabledError (${errInfo}).`);
  }

  // --- err()-Mapping isoliert testen (ohne laufenden Next.js-Server) ---
  let mappingOk = false;
  let mappingInfo = "";
  try {
    const response = err(new ModuleDisabledError("pms"));
    const status = response.status;
    const body = (await response.json()) as { error: { code: string; message: string; details?: unknown } };
    const statusOk = status === 404;
    const codeOk = body.error.code === "not_found";
    const noLeak = body.error.details === undefined && !JSON.stringify(body).includes("pms");
    mappingOk = statusOk && codeOk && noLeak;
    mappingInfo = `status=${status} code=${body.error.code} message=${JSON.stringify(body.error.message)} details=${JSON.stringify(body.error.details)}`;
  } catch (e) {
    mappingInfo = `err()-Aufruf ist fehlgeschlagen (${e instanceof Error ? e.message : String(e)}) — evtl. next/server ausserhalb eines Next.js-Request-Kontexts nicht lauffaehig.`;
  }
  if (!mappingOk) {
    allOk = false;
    details.push(`FEHLER: err(new ModuleDisabledError('pms')) mapt nicht korrekt auf 404 ohne moduleKey-Leak. ${mappingInfo}`);
  } else {
    details.push(`err()-Mapping isoliert getestet: ModuleDisabledError -> HTTP 404, generischer Body, moduleKey NICHT im Response-Body geleakt. ${mappingInfo}`);
  }

  // --- Aufraeumen: Hotel B wieder auf konsistenten Ausgangszustand ---
  await pool.query(`update hotel_modules set enabled = true, enabled_at = now() where hotel_id = $1 and module_key = 'pms'`, [
    fixtures.hotelB.id,
  ]);
  details.push(`hotel_modules.enabled wieder auf true fuer Hotel B / 'pms' gesetzt (sauberer Endzustand).`);

  record(4, "Entitlement-Check (ModuleDisabledError -> 404, kein 403)", allOk ? "PASS" : "FAIL", details.join("\n"));
  assertTrue(allOk, "Entitlement-Check");
}
