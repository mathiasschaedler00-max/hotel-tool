# 0006 — Offline-/Sync-Constraints jetzt schon einhalten (K6)

## Kontext

Mobile Apps (Personal-/Gäste-App) sind für Phase 3–4 geplant, mit Offline-
Sync über lokales SQLite + Sync-Schicht (React Native/Expo). Ein
nachträglicher Umbau des Datenmodells, um Offline-Fähigkeit zu ermöglichen,
wäre teuer (Migrationen auf Produktivdaten, Client-Rewrite). Phase 0 soll
diesen Rewrite verhindern, OHNE die eigentliche Sync-Implementierung
vorwegzunehmen.

## Entscheidung

Fünf Constraints ab Phase 0 in jeder fachlichen Tabelle:

1. **Client-generierbare UUID als Primärschlüssel** auf jeder Zeile
   (`gen_random_uuid()` serverseitig als Default, aber nichts hindert einen
   Offline-Client später daran, seine eigene UUID lokal zu vergeben).
2. **`updated_at`** auf jeder veränderlichen Tabelle, per `before update`-
   Trigger (`set_updated_at()`) automatisch gepflegt — Grundlage für spätere
   Konflikterkennung. Ob die Strategie später Last-Write-Wins oder ein
   Feld-Merge wird, ist explizit NICHT hier entschieden (siehe
   "Konsequenzen").
3. **`events`-Tabelle** als künftiger, monoton wachsender Sync-Log
   (Append-Only) — Mobile Clients fragen später "alles seit Cursor X" ab.
   Wird parallel zum pg-boss-Publish in derselben Transaktion befüllt (siehe
   ADR 0002).
4. **Idempotency-Key-Unterstützung**: `idempotency_keys`-Tabelle existiert
   bereits (Migration `events_and_idempotency`), die tatsächliche Prüfung in
   der API-Schicht ist aber noch NICHT verdrahtet (siehe "Konsequenzen").
5. **Menschenlesbare IDs getrennt vom Primärschlüssel**
   (`reservations.reservation_no` ≠ `reservations.id`) — ein Offline-Client
   kann lokal mit der UUID anlegen, die menschenlesbare Nummer kommt erst
   beim Sync mit dem Server.

Kein serverseitiger Auto-Increment als einziger Identifier irgendwo im
Schema.

## Konsequenzen

- Die Konflikterkennungs-STRATEGIE (Last-Write-Wins vs. Feld-Merge) ist
  bewusst NICHT in Phase 0 entschieden — nur die Voraussetzung (`updated_at`)
  ist gelegt. Eine spätere ADR muss das explizit festlegen, sobald die
  Sync-Schicht (Phase 3–4) ansteht.
- Die Idempotency-Key-Prüfung ist aktuell nur als Tabelle + als aus dem
  `Idempotency-Key`-Header gelesenes Feld in `ModuleContext.idempotencyKey`
  vorbereitet (`modules/_shared/context.ts`) — die eigentliche
  Speicher-/Vergleichslogik in den Route-Handlern ist TODO, explizit als
  Phase-1-Arbeit markiert.
- Jede neue Tabelle MUSS diesen fünf Punkten folgen, sonst entsteht später
  beim Sync-Feature technische Schuld, die genau die Migrationen erfordert,
  die diese ADR vermeiden soll.

## Verworfene Alternativen

- **Auto-Increment-IDs mit späterer UUID-Migration**: hätte eine
  Breaking-Change-Migration über alle Fremdschlüssel hinweg nötig gemacht,
  sobald Offline-Clients UUIDs brauchen — genau der Rewrite, den diese
  Entscheidung verhindern soll.
- **Sync-Strategie schon jetzt festlegen** (z. B. hart Last-Write-Wins):
  wäre eine Entscheidung ohne die nötige Grundlage (echte
  Konfliktszenarien aus der Mobile-App gibt es noch nicht) — bewusst
  offengelassen, um keine falsche Festlegung zu treffen, die sich später
  rächt.
