# Architektur — Hotel Tool

Multi-Tenant Hotel-PMS (Property Management System) für JMS Digital
Solutions. Dieses Dokument beschreibt den Stand nach **Phase 0 — Fundament**:
reine Grundarchitektur, keine sichtbare UI. Die vollständige Spezifikation
dieser Phase liegt in `/Users/mathias/.claude/plans/teil-b-die-staged-codd.md`
(maßgeblich für alle hier getroffenen Entscheidungen).

## Nicht verhandelbare Vorgaben

1. Geschäftslogik lebt ausschließlich in `/modules/*` — Next.js-API-Routen
   rufen diese nur auf, enthalten selbst keine Fachlogik.
2. Kritische Schreibzugriffe laufen nie direkt vom Browser an Supabase —
   alles Schreibende über die eigene API-Schicht (Audit-Log, Entitlement-
   Prüfung, Fiskal-Logik hängen dort). RLS ist die zweite
   Verteidigungslinie, nicht die einzige.
3. Hintergrund-Jobs von Anfang an über **pg-boss**, das gleichzeitig als
   Event-Bus dient.
4. Supabase-Region Frankfurt (DSGVO/DACH). Supabase = nur Postgres, kein
   Lock-in.
5. Stack: Next.js (App Router) + Supabase + Tailwind + TypeScript.

## Ordnerstruktur

```
hotel-tool/
├── ARCHITECTURE.md              # diese Datei
├── RETENTION.md                 # Backup-/Restore-Dokumentation (Platzhalter)
├── docs/
│   ├── adr/                     # Architecture Decision Records, siehe unten
│   └── design/                  # Platzhalter für das künftige Tailwind-Design-System
├── supabase/migrations/         # SQL-Migrationen, echte supabase-CLI-Timestamps
├── modules/                     # die "eigene, saubere Schicht" (Vorgabe #1)
│   ├── _shared/                 # ModuleContext, Fehler-Hierarchie, executeWrite(),
│   │                            # Topic-Registry, Response-Envelope, tenant-guard.ts
│   │                            # (assertBelongsToHotel(), für alle Module nutzbar)
│   ├── entitlements/            # Modul-Schalter-Durchsetzung (404-Hiding)
│   ├── rbac/                    # Rollen→Permission-Matrix, requirePermission()
│   ├── audit/                   # writeAudit()/writeAiDecision(), von write.ts genutzt
│   ├── notifications/           # E-Mail-Queue (enqueueEmail + Job-Handler-Platzhalter)
│   ├── pms/                     # hotels, rooms, room-types, guests, reservations,
│   │                            # folios, payments
│   └── housekeeping/tasks/      # Aufgaben, subscribed auf booking.checked_out
├── lib/                         # dünne Infrastruktur-Adapter, KEINE Businesslogik
│   ├── supabase/{client,server,service}.ts
│   ├── db/pool.ts               # roher pg.Pool (Transaction-Pooler) für Mehrschritt-TX
│   ├── queue/boss.ts             # pg-boss-Singleton + typisierte send/publish/subscribe
│   ├── hotel-context.ts          # Cookie-basierte "aktives Hotel"-Auswahl
│   └── format.ts                 # formatEuro()/formatDate() (de-AT), zentral fürs UI
├── worker/index.ts               # bootet pg-boss, registriert alle modules/*/jobs.ts
├── scripts/
│   ├── verify-foundation/        # Phase-0-Abnahmetest (8 Punkte)
│   ├── verify-phase1/            # Phase-1-Verifikation, ein Skript pro Schritt
│   └── seed-demo.ts              # Demo-Daten fürs Dev-Hotel (Zimmer/Kategorien/
│                                  # Reservierungen) — NIE gegen echte Kundendaten
└── src/
    ├── proxy.ts                  # Next 16: Nachfolger von middleware.ts (Auth/2FA-Guard).
    │                              # Liegt bewusst hier (Ebene von `app/`), NICHT unter
    │                              # `src/app/proxy.ts` wie im Architekturplan-Text —
    │                              # siehe Kommentar am Dateikopf für die Begründung.
    └── app/
        ├── api/v1/pms/reservations/     # dünne Route-Handler
        └── (dashboard)/                 # Route Group (ändert die URL nicht):
            ├── layout.tsx               # Seitennavigation, Hotel-Umschalter
            ├── rooms/                   # Zimmerverwaltung (Schritt 1)
            └── calendar/                # Belegungsplan / Tape Chart (Schritt 2)
```

## Architecture Decision Records

| ADR | Thema |
|---|---|
| [0001](docs/adr/0001-multi-tenant-rls.md) | Multi-Tenant-Isolation über RLS + `hotel_id` |
| [0002](docs/adr/0002-transactional-write-path.md) | Transaktionaler Write-Pfad (`executeWrite`) |
| [0003](docs/adr/0003-pg-boss-event-bus.md) | pg-boss als Event-Bus + Job-Queue |
| [0004](docs/adr/0004-entitlements-404-hiding.md) | Entitlements: deaktivierte Module liefern 404, nicht 403 |
| [0005](docs/adr/0005-rbac-matrix-code-vs-db.md) | RBAC-Rechte-Matrix lebt im Code, nicht in der DB |
| [0006](docs/adr/0006-offline-sync-constraints.md) | Offline-/Sync-Constraints jetzt schon einhalten (K6) |
| [0007](docs/adr/0007-security-2fa-backups.md) | Sicherheitsbasis: Verschlüsselung, 2FA, Backups (K7) |

## Design-System

UI-Design ist bereits als Klick-Prototyp in Claude Design vorhanden (8
Referenz-Screens: Belegungsplan, Rezeption, Check-in-Ablauf, Housekeeping
inkl. Eskalationen, Besitzer-Dashboard, Gäste-App, KI-Rezeption). Wird zu
Beginn der ersten UI-tragenden Phase als Tailwind-Design-System (Farben,
Typo, Komponenten) implementiert – nicht Teil von Phase 0.

## Offene Punkte / was noch fehlt

- **Supabase-Projekt**: läuft real, Region Frankfurt (Projekt "HotelOS",
  `qgpxgevccqywwxxqmqfk`). Aktuell auf dem Free Plan — kein Point-in-Time-
  Recovery, keine automatischen täglichen Backups. Das ist ein **Pflicht-Gate
  vor Phase-1-Schritt 6** (Zahlungen/echte Gästedaten), siehe
  `/Users/mathias/.claude/plans/teil-b-die-staged-codd.md`, Abschnitt
  "PFLICHT-GATE vor Schritt 6".
- **Worker-Hosting**: läuft real auf Fly.io (`hotel-tool-worker`, Region
  `fra`), bootet pg-boss und registriert alle `modules/*/jobs.ts`.
- **Tests**: Die 8-Punkte-Phase-0-Abnahme (`scripts/verify-foundation/`) ist
  gegen die echte Supabase-DB durchgeführt (22.08.2026), inklusive eines
  Backup/Restore-Tests (siehe `RETENTION.md` — lief allerdings gegen eine
  faktisch leere Datenbank, ein erneuter Restore-Test ist Teil des
  Pflicht-Gates vor Schritt 6). Phase 1 führt das Testmuster unter
  `scripts/verify-phase1/` fort.
- Teil A (Rollen-/Rechte-Matrix im Detail, Fiskal-/RKSV-Anforderungen,
  Storno-Regeln) und Teil D (vollständiger Modul-Katalog) liegen noch nicht
  vor — alle betroffenen Stellen sind im Code mit `// TODO: Geschäftsregeln
  aus Teil A ergänzen` bzw. "Annahme — Teil A/D prüfen" markiert.
- **Phase 1** läuft in 11 vorgegebenen Schritten (siehe Plan-Datei oben).
  Aktueller Stand: Schritt 1 (Zimmerverwaltung + Zimmerstatus) und Schritt 2
  (Buchungskalender / Tape Chart V1, inkl. App-Shell unter
  `src/app/(dashboard)/`) sind umgesetzt. Schritte 3–11 (Reservierungen
  inkl. Überbuchungsschutz, Check-in/-out, Folio, Zahlungen, Fiskalisierung,
  Night Audit, Rezeption, Debitoren, Buchhaltungs-Export) stehen noch aus.
