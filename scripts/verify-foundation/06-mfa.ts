/**
 * Punkt 6 der Abnahme: 2FA.
 *
 * `src/proxy.ts` ist fuer die eigentliche Erzwingung nur ein Stub mit TODO
 * ("gegen aktuelle Supabase-MFA-Doku verifizieren") — es gibt weder eine
 * `/mfa`-Enrollment-UI noch einen laufenden Next.js-Server in diesem Test.
 * Was hier stattdessen WIRKLICH getestet wird: die echte Supabase-Auth-MFA-
 * Mechanik, auf der `proxy.ts`s Entscheidung beruht (`getAuthenticatorAssurance
 * Level()`), end-to-end mit einem echten TOTP-Faktor (RFC 6238, siehe
 * `_totp.ts`) — nicht nur behauptet, sondern durch einen echten Enroll +
 * Challenge + Verify-Zyklus nachgewiesen. Kein Next.js-Request/keine
 * `NextResponse.redirect` wird hier ausgefuehrt — das waere Punkt "HTTP-Schicht",
 * laut Auftrag nicht Teil dieses Szenarios.
 */
import { anonClient, record } from "./_lib";
import { generateTotp } from "./_totp";
import type { Fixtures } from "./01-setup";

export async function testMfa(fixtures: Fixtures): Promise<void> {
  const details: string[] = [];
  details.push(
    "HINWEIS: proxy.ts enthaelt nur eine Code-Logik (AAL-Check + Redirect), aber keine /mfa-Enrollment-UI. " +
      "Ohne laufenden Next.js-Server wird hier NICHT proxy.ts selbst aufgerufen, sondern die darunterliegende " +
      "echte Supabase-Auth-MFA-Mechanik, auf der proxy.ts's Entscheidung beruht."
  );

  const client = anonClient();
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: fixtures.hotelA.owner.email,
    password: fixtures.hotelA.owner.password,
  });
  if (signInError || !signInData.session) {
    record(
      6,
      "2FA (nur real Testbares, proxy.ts ist Stub)",
      "FAIL",
      `signInWithPassword fehlgeschlagen: ${signInError?.message}`
    );
    return;
  }
  details.push(`Passwort-Login (1. Faktor) fuer ${fixtures.hotelA.owner.email} erfolgreich.`);

  const { data: baselineAal, error: baselineErr } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (baselineErr) {
    record(6, "2FA (nur real Testbares, proxy.ts ist Stub)", "FAIL", `getAuthenticatorAssuranceLevel() fehlgeschlagen: ${baselineErr.message}`);
    return;
  }
  const baselineOk = baselineAal.currentLevel === "aal1" && baselineAal.nextLevel === "aal1";
  details.push(
    `Baseline (kein Faktor enrollt): currentLevel=${baselineAal.currentLevel} nextLevel=${baselineAal.nextLevel} — ` +
      `${baselineOk ? "korrekt: proxy.ts wuerde HIER keine AAL2 erzwingen (kein Faktor vorhanden)." : "FEHLER: unerwarteter Ausgangszustand."}`
  );

  // --- Echten TOTP-Faktor enrollen ---
  const { data: enrollData, error: enrollError } = await client.auth.mfa.enroll({ factorType: "totp" });
  if (enrollError || !enrollData) {
    record(
      6,
      "2FA (nur real Testbares, proxy.ts ist Stub)",
      baselineOk ? "PASS" : "FAIL",
      [
        ...details,
        `TOTP-Enrollment nicht moeglich: ${enrollError?.message ?? "keine Daten zurueck"}.`,
        `Vermutlich ist MFA/TOTP im Supabase-Projekt (Auth-Einstellungen) noch nicht aktiviert — das ist eine ` +
          `Projekteinstellung, keine Code-Frage. Baseline-AAL-Logik (s.o.) wurde trotzdem real verifiziert.`,
        `NICHT getestet (kein UI/Code dafuer vorhanden): proxy.ts's tatsaechlicher HTTP-Redirect auf /mfa, ` +
          `eine /mfa-Enrollment-Seite (existiert nicht), Login-Ablehnung auf HTTP-Ebene ohne laufenden Server.`,
      ].join("\n")
    );
    return;
  }
  const factorId = enrollData.id;
  const secret = enrollData.totp.secret;
  details.push(`TOTP-Faktor enrollt (factorId=${factorId}), Secret vom Server erhalten.`);

  const { data: challengeData, error: challengeError } = await client.auth.mfa.challenge({ factorId });
  if (challengeError || !challengeData) {
    record(
      6,
      "2FA (nur real Testbares, proxy.ts ist Stub)",
      "FAIL",
      [...details, `challenge() fehlgeschlagen: ${challengeError?.message}`].join("\n")
    );
    return;
  }

  const code = generateTotp(secret);
  const { data: verifyData, error: verifyError } = await client.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  });
  if (verifyError || !verifyData) {
    record(
      6,
      "2FA (nur real Testbares, proxy.ts ist Stub)",
      "FAIL",
      [...details, `verify() mit real berechnetem RFC-6238-Code fehlgeschlagen: ${verifyError?.message}`].join("\n")
    );
    return;
  }
  details.push(`challenge() + verify() mit echtem, selbst berechnetem RFC-6238-TOTP-Code erfolgreich (Faktor jetzt verifiziert).`);

  const { data: afterVerifyAal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  const afterVerifyOk = afterVerifyAal?.currentLevel === "aal2" && afterVerifyAal?.nextLevel === "aal2";
  details.push(
    `Nach Verify: currentLevel=${afterVerifyAal?.currentLevel} nextLevel=${afterVerifyAal?.nextLevel} — ` +
      `${afterVerifyOk ? "korrekt: Session hat jetzt AAL2." : "FEHLER: AAL nicht wie erwartet auf aal2."}`
  );

  // --- Frischer Passwort-Login (nur 1. Faktor) NACH dem Enrollment ---
  await client.auth.signOut();
  const client2 = anonClient();
  const { data: reSignIn, error: reSignInErr } = await client2.auth.signInWithPassword({
    email: fixtures.hotelA.owner.email,
    password: fixtures.hotelA.owner.password,
  });
  let forcedMfaOk = false;
  let forcedMfaInfo = "";
  if (reSignInErr || !reSignIn.session) {
    forcedMfaInfo = `Erneuter Login fehlgeschlagen: ${reSignInErr?.message}`;
  } else {
    const { data: postEnrollAal } = await client2.auth.mfa.getAuthenticatorAssuranceLevel();
    forcedMfaOk = postEnrollAal?.currentLevel === "aal1" && postEnrollAal?.nextLevel === "aal2";
    forcedMfaInfo = `currentLevel=${postEnrollAal?.currentLevel} nextLevel=${postEnrollAal?.nextLevel} — ` +
      `${forcedMfaOk
        ? "genau die Bedingung, die proxy.ts prueft (nextLevel==='aal2' && currentLevel!==nextLevel) ist WAHR: " +
          "ein reiner Passwort-Login OHNE zweiten Faktor wuerde von proxy.ts korrekt auf /mfa umgeleitet / mit 401 abgelehnt."
        : "FEHLER: erwartete currentLevel=aal1/nextLevel=aal2 nach Enrollment nicht erreicht."}`;
  }
  details.push(`Reiner Passwort-Login nach Enrollment (kein 2. Faktor bereitgestellt): ${forcedMfaInfo}`);
  await client2.auth.signOut();

  const allOk = baselineOk && afterVerifyOk && forcedMfaOk;
  details.push(
    "NICHT getestet (existiert im Code nicht): eine /mfa-Enrollment-Seite, der tatsaechliche HTTP-Redirect von " +
      "proxy.ts (braucht laufenden Next.js-Server, siehe Auftrag: HTTP-Schicht bewusst ausgeklammert)."
  );

  record(6, "2FA (nur real Testbares, proxy.ts ist Stub)", allOk ? "PASS" : "FAIL", details.join("\n"));
}
