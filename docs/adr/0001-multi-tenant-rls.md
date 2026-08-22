# 0001 — Multi-Tenant-Isolation über RLS + `hotel_id`

## Kontext

Hotel Tool ist von Anfang an Multi-Tenant: mehrere Hotels teilen sich dieselbe
Datenbank. Jede fachliche Zeile muss eindeutig einem Hotel zugeordnet und
gegen den Zugriff anderer Hotels isoliert sein. Ein Fehler hier ist das
teuerste denkbare Datenleck in einem PMS (Gästedaten, Zahlungen eines Hotels
für ein anderes sichtbar).

## Entscheidung

- Jede fachliche Tabelle bekommt eine `hotel_id`-Spalte (`references
  hotels(id) on delete cascade`) und einen Index `(hotel_id) where deleted_at
  is null`.
- Row Level Security ist auf jeder Tabelle aktiv. Statt der Policy die
  Mitgliedschaft per Inline-Subquery prüfen zu lassen, gibt es zwei
  `security definer`-SQL-Funktionen (`is_hotel_member(hotel_id)`,
  `hotel_role(hotel_id)`), die die Policies referenzieren. Das vermeidet
  RLS-Rekursionsprobleme bei verschachtelten Policies und ist planbar/cachebar
  (Postgres kann den Funktionsaufruf im Query-Plan behandeln wie einen
  einfachen Prädikat-Check).
- RLS ist explizit die **zweite** Verteidigungslinie, nicht die einzige
  (Vorgabe #2 aus dem Architekturplan). Die API-Schicht (`modules/*`) prüft
  Hotel-Zugehörigkeit und Rolle bereits vor jedem Schreibzugriff
  (`getModuleContext()` + `requirePermission()`). Nur lesende
  Browser-/Realtime-Queries über `lib/supabase/client.ts` verlassen sich
  ausschließlich auf RLS — dort muss die Policy also auf jeder Tabelle
  korrekt stehen.
- Schreibender Zugriff über den transaktionalen Write-Pfad
  (`modules/_shared/write.ts`) läuft über eine Service-Role-Verbindung und
  umgeht RLS bewusst — die Autorisierung ist zu diesem Zeitpunkt schon
  passiert.

## Konsequenzen

- Jede neue fachliche Tabelle MUSS beim Anlegen das Policy-Muster + den Index
  bekommen — vergisst man das, ist die Tabelle über den Service-Client zwar
  nutzbar, aber ungeschützt gegenüber direktem Browser-Zugriff.
- `is_hotel_member()`/`hotel_role()` sind ein Single Point of Truth für
  Mitgliedschaft — Änderungen an der Mitgliedschaftslogik (z. B. zeitlich
  befristete Zugriffe) passieren an genau einer Stelle.
- Die Verifikation aus dem Architekturplan (Punkt 2: Mandantentrennung testen
  — User A darf Hotel B weder über den Browser-Client noch über die API mit
  falscher Hotel-ID lesen/schreiben) hängt direkt an dieser Entscheidung.

## Verworfene Alternativen

- **Inline-Subquery-Policies** (`hotel_id in (select … from hotel_members
  where user_id = auth.uid())` direkt in jeder Policy): funktioniert, ist
  aber pro Tabelle dupliziert und anfälliger für Copy-Paste-Fehler; die
  Helper-Funktion zentralisiert die Logik.
- **Separates Schema/DB pro Hotel**: bietet stärkere Isolation, aber
  unverhältnismäßiger operativer Aufwand (Migrationen, Backups, Pooling) für
  ein 1–2-Personen-Team und eine anfängliche Hotelzahl im niedrigen
  zweistelligen Bereich.
- **Nur App-Level-Filtering ohne RLS**: ein einziger vergessener
  `WHERE hotel_id = …`-Filter in einer Server-Funktion würde sofort zu einem
  Cross-Tenant-Leck führen — widerspricht explizit Vorgabe #2 ("RLS ist die
  zweite Verteidigungslinie, nicht die einzige").
