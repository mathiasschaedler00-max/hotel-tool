# 0007 — Sicherheitsbasis: Verschlüsselung, 2FA, Backups (K7)

## Kontext

Ein Hotel-PMS verarbeitet besonders sensible Daten (Gäste-Ausweisnummern,
Zahlungsdaten) und unterliegt absehbar Aufbewahrungspflichten (österreichisches
Abgabenrecht, analog zur bestehenden `RETENTION.md`-Praxis im
Referenzprojekt). Es existiert noch kein echtes Supabase-Projekt — die
Sicherheitsbasis muss trotzdem architektonisch vorbereitet sein, damit sie
beim ersten echten Projekt nicht nachträglich draufgesetzt wird.

## Entscheidung

- **Verschlüsselung**: TLS in transit + AES-256 at rest sind Supabase-Default
  für die gesamte Datenbank. Zusätzlich: feldebene Verschlüsselung für
  besonders sensible Gästedaten (Platzhalter-Implementierung:
  `modules/pms/guests/service.ts#encryptDocumentNumber()`, AES-256-GCM) VOR
  dem Insert in `guests.document_number_encrypted` — ein DB-Dump enthält
  dieses Feld dadurch nicht im Klartext.
- **2FA**: Supabase Auth MFA (TOTP) für alle `hotel_members`-Logins, NICHT
  für Gäste-Logins. `src/proxy.ts` prüft den AAL-Status
  (`supabase.auth.mfa.getAuthenticatorAssuranceLevel()`) und erzwingt AAL2
  für angemeldete, nicht-öffentliche Routen inkl. `/api/v1/*`.
- **Backups**: Supabase Pro (tägliche Backups + PITR) plus monatlicher
  unabhängiger `pg_dump`-Export auf externen Speicher (nicht bei Supabase
  selbst) — Platzhalter-Dokumentation in `RETENTION.md`, noch ohne echte
  Einträge (kein echtes Projekt).
- **Restore-Test** ist Pflichtbestandteil der Phase-0-Abnahme (Punkt 7 der
  Verifikation), nicht nur "Backup existiert" — `RETENTION.md` hat eine
  Log-Tabellen-Vorlage dafür (Datum/Ergebnis/nächste Fälligkeit).
- **Secrets**: Service-Role-Key/DB-Connection-Strings nur in Server-/
  Worker-Env (`.env.local`, nie `NEXT_PUBLIC_`-Präfix), analog zum
  Referenzprojekt.

## Konsequenzen

- Die MFA-Prüfung in `proxy.ts` ist ausdrücklich als TODO markiert ("gegen
  aktuelle Supabase-MFA-Doku verifizieren") — `@supabase/auth-js` ändert
  gelegentlich Methodennamen/Response-Formen zwischen Versionen, das muss vor
  Produktivbetrieb erneut geprüft werden.
- Die Feldverschlüsselung ist ein Platzhalter mit einem einzelnen
  Umgebungs-Secret (`GUEST_DOCUMENT_ENCRYPTION_KEY`) — Schlüssel-Rotation und
  echtes KMS sind explizit NICHT Teil von Phase 0.
- `RETENTION.md` bleibt so lange ein Platzhalter, bis ein echtes
  Supabase-Projekt existiert und ein erster echter Restore-Test durchgeführt
  wurde — die Phase-0-Abnahme (Verifikationspunkt 7) ist erst dann
  reproduzierbar grün.
- Welche Gästefelder GENAU feldverschlüsselt werden müssen, ist eine offene
  Annahme (Teil A) — aktuell nur die Ausweis-/Passnummer.

## Verworfene Alternativen

- **2FA erst in einer späteren Phase einführen**: widerspricht der
  expliziten, nicht verhandelbaren Vorgabe, Hintergrund-Infrastruktur und
  Sicherheitsbasis von Anfang an mitzudenken; nachträgliches Erzwingen von
  2FA für Bestandsnutzer ist ein schlechteres Rollout-Erlebnis als von
  Anfang an.
- **Nur Supabase-Backups, kein eigener Export**: Vendor-Lock-in-Risiko für
  eine mehrjährige Aufbewahrungspflicht — ein unabhängiger monatlicher Export
  stellt sicher, dass die Daten auch bei einem Supabase-Ausfall/-Kontostreit
  verfügbar bleiben.
- **Verschlüsselung auf DB-Ebene via `pgcrypto`-Spaltenfunktionen** (z. B.
  `pgp_sym_encrypt` direkt in SQL): hätte den Schlüssel potenziell in
  Query-Logs oder in der DB-Konfiguration selbst sichtbar gemacht;
  Verschlüsselung in der Anwendungsschicht (`modules/pms/guests/service.ts`)
  hält den Schlüssel außerhalb der Datenbank.
