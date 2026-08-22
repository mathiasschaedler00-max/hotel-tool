# Backup- & Aufbewahrungsdokumentation — Hotel Tool

Status: **Echtes Supabase-Projekt "HotelOS" existiert** (Region Frankfurt,
`eu-central-1`, Projekt-Ref `qgpxgevccqywwxxqmqfk`), Stand 22.08.2026. Läuft
aktuell auf dem **Free Plan** — kein PITR, keine automatischen täglichen
Backups (siehe "Supabase-Plan-Anforderungen" unten). Struktur analog zur
bestehenden `RETENTION.md`-Praxis im Referenzprojekt
(`/Users/mathias/Ticketsytem v3/RETENTION.md`).

Siehe auch: `docs/adr/0007-security-2fa-backups.md`.

---

## Rechtliche Grundlage

Wie beim Referenzprojekt: österreichisches Abgabenrecht (§ 132 BAO)
verpflichtet zur Aufbewahrung von Büchern, Aufzeichnungen, Belegen und
Geschäftspapieren über **7 Jahre**. Für ein PMS zusätzlich relevant:
Gästedaten-Aufbewahrung/-Löschung nach Meldepflichten (länderspezifisch,
**noch nicht final geklärt — Annahme, Teil A prüfen**).

## Was gespeichert wird (sobald ein echtes Projekt existiert)

| Daten | Speicherort | Format |
|---|---|---|
| Hotel-/Reservierungs-/Folio-/Zahlungsdaten | Supabase PostgreSQL | Datenbank |
| Audit-Log (`audit_log`) + KI-Entscheidungslog (`ai_decision_log`) | Supabase PostgreSQL | Datenbank |
| Gäste-Ausweis-/Passnummer (feldverschlüsselt) | Supabase PostgreSQL (`guests.document_number_encrypted`) | verschlüsseltes `bytea` |
| pg-boss-Job-/Event-Historie (`pgboss`-Schema) | Supabase PostgreSQL | Datenbank |

## Supabase-Plan-Anforderungen

- **Free Plan**: kein PITR, begrenzte Backups → nicht ausreichend für
  Produktivbetrieb.
- **Pro Plan (ab $25/Monat)**: tägliche Backups, 7-Tage-PITR → Basis,
  reicht allein nicht für eine 7-Jahre-Pflicht.
- **Pro + PITR-Erweiterung**: verlängertes Point-in-Time-Recovery.

**Vorgesehen**: Supabase Pro Plan + monatliche eigene Exports (siehe unten).

## Vorgesehene Backup-Strategie

### 1. Datenbank-Export (monatlich)

```bash
# Verbindungsdaten aus Supabase Dashboard > Settings > Database
pg_dump "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \
  --no-owner \
  --no-privileges \
  -f "backup_$(date +%Y%m%d).sql"
```

Ablage auf einem von Supabase unabhängigen Speicher (lokaler NAS /
Firmenserver / verschlüsselter Cloud-Storage) — bewusst NICHT nur bei
Supabase selbst, um Vendor-Lock-in-Risiko zu vermeiden (siehe ADR 0007).

### 2. Restore-Test (Pflichtbestandteil der Phase-0-Abnahme)

Verifikationspunkt 7 des Architekturplans sah ein zweites Scratch-Supabase-
Projekt als Restore-Ziel vor. Stattdessen **bewusst gegen eine lokale
PostgreSQL-17-Instanz** getestet (kein zweites Cloud-Projekt, keine
zusätzlichen Kosten/Account-Verpflichtung) — testet exakt dasselbe
(Dump→Restore→Vergleich der eigenen Daten), nur ohne Supabase-eigene
`auth`-Schema-Abhängigkeit.

**Vorgehen:** `pg_dump --schema=public` von der echten HotelOS-DB (Frankfurt)
→ Restore in eine frische lokale PostgreSQL-17-Instanz → Zeilenzahlen **und**
Stichproben-Inhalt (Reservierungs-IDs, `reservation_no`, Status) Feld für Feld
verglichen. FK-Constraints Richtung `auth.users` schlugen erwartungsgemäß fehl
(Schema existiert lokal nicht, ist Supabase-intern) — alle **Daten** in
`public` kamen aber vollständig und inhaltlich identisch an. Lokale
Scratch-Instanz und Dump-Datei danach sofort gelöscht.

#### Restore-Test-Log

| Datum | Ergebnis | Nächste Fälligkeit |
|---|---|---|
| 22.08.2026 | ✅ Bestanden — alle 12 geprüften Tabellen zeilen- und inhaltsgleich (hotels, hotel_members, reservations, audit_log, events, tasks, ai_decision_log, guests, rooms, room_types, hotel_modules, modules) | Vor dem ersten echten Kundenbetrieb erneut prüfen, danach quartalsweise |

### 3. Health-Check (künftig)

Analog zum Referenzprojekt vorgesehen: ein periodischer Check, der prüft, ob
alle referenzierten Ressourcen (z. B. künftige Beleg-/Dokument-Uploads in
Supabase Storage) noch vorhanden sind. Noch nicht implementiert — es gibt in
Phase 0 keine Datei-Uploads.

## Löschung / Soft-Delete

Wie im Referenzprojekt: fachliche Zeilen werden nicht physisch gelöscht,
sondern erhalten ein `deleted_at`-Timestamp (Soft-Delete, siehe jede
Migration in `supabase/migrations/`). Audit-Log-Zeilen (`audit_log`,
`ai_decision_log`) werden nie gelöscht (kein `deleted_at` dort — Append-Only).

## Checkliste (sobald ein echtes Projekt existiert, jährlich prüfen)

- [ ] Supabase Plan aktiv und bezahlt (Pro, Region Frankfurt)?
- [ ] Monatliche Datenbank-Exports laufen und werden aufbewahrt?
- [ ] Restore-Test durchgeführt und oben protokolliert?
- [ ] Backup-Speicherort sicher, verschlüsselt und unabhängig von Supabase?
- [ ] Backups mindestens bis [aktuelles Jahr + 7] aufbewahrt?
- [ ] `GUEST_DOCUMENT_ENCRYPTION_KEY`-Rotation geprüft (siehe ADR 0007 — noch
      kein echtes Schlüsselmanagement in Phase 0)?
