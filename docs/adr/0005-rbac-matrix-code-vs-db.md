# 0005 — RBAC-Rechte-Matrix lebt im Code, nicht in der DB

## Kontext

"Teil A" (Rollenliste + Rechte-Matrix, K2) liegt noch nicht final vor. Es gibt
einen plausiblen Entwurf mit 7 Startrollen (`owner`, `general_manager`,
`front_office`, `housekeeping_staff`, `accounting`, `maintenance`,
`readonly`), aber keine bestätigte Fachvorgabe. Das Team besteht aus 1–2
Personen.

## Entscheidung

- Die Rolle eines Users pro Hotel wird in der DB gespeichert
  (`hotel_members.role`, per `check`-Constraint auf die 7 Startrollen
  beschränkt) — auditierbar über `audit_log.actor_role`.
- Die Zuordnung Rolle → Permissions lebt im Code
  (`modules/rbac/permissions.ts#PERMISSIONS`), nicht in einer normalisierten
  `role_permissions`-Tabelle.
- `requirePermission(ctx, permission)` prüft gegen dieses Objekt zur
  Laufzeit, mit Prefix- (`"pms.*"`) und Suffix-Wildcards (`"*.read"`).

## Konsequenzen

- Eine Rechte-Änderung braucht ein Code-Deployment, keine Datenmigration —
  für die aktuelle Teamgröße schneller und mit weniger Overhead als ein
  DB-getriebenes RBAC-System.
- Die Migration zu DB-Permissions bleibt additiv möglich: `hotel_members.role`
  ändert sich nicht, nur die Nachschlage-Logik in `requirePermission()` müsste
  ausgetauscht werden (z. B. gegen eine `role_permissions`-Tabelle), die
  Aufrufstellen in den Modul-Funktionen bleiben unverändert.
- Sobald Teil A vorliegt, ist `PERMISSIONS` die einzige Stelle, die sich
  ändern muss (plus ggf. der `check`-Constraint in
  `supabase/migrations/..._tenants_and_rls_core.sql`, falls sich die
  Rollenliste selbst ändert).
- Bugfix während der Umsetzung: das Plan-Codebeispiel für
  `requirePermission()` prüfte nur Prefix-Wildcards (`"pms.*"`), nicht aber
  die von der `readonly`-Rolle verwendeten Suffix-Wildcards (`"*.read"`) —
  wörtlich übernommen wäre `readonly` faktisch rechtlos gewesen. Die
  Implementierung hier prüft beide Richtungen.

## Verworfene Alternativen

- **Vollständige DB-RBAC-Engine** (`permissions`-Tabelle,
  `role_permissions`-Join-Tabelle, Admin-UI zum Bearbeiten): Overengineering
  für ein 1–2-Personen-Team und eine noch nicht finalisierte Rechte-Matrix —
  würde Komplexität für eine Flexibilität kaufen, die aktuell niemand braucht.
- **Permissions direkt als JSONB-Spalte pro User**: verliert die Übersicht
  "welche Rolle darf was" als zentrales, überprüfbares Artefakt und macht
  Audits schwerer (Frage "wer darf X" wäre nicht mehr an einer Stelle
  beantwortbar).
