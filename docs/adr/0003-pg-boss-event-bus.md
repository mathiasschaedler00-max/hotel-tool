# 0003 — pg-boss als Event-Bus + Job-Queue

## Kontext

Hintergrund-Jobs sind von Anfang an gesetzt (Vorgabe #3): Night Audit,
Channel-Manager-Sync (später), Event-Verarbeitung, Mail-Versand. Zusätzlich
braucht das System einen einfachen Event-Bus (K3), damit z. B. ein Check-out
in `pms` eine Reaktion in `housekeeping` auslösen kann, ohne dass beide Module
sich gegenseitig kennen (Entkopplung, Vorgabe #1: Module bleiben unabhängig).

Das Team ist 1–2 Personen groß — ein zusätzliches Infrastruktur-System (z. B.
RabbitMQ, SQS, Redis-Queue) bedeutet zusätzlichen Betriebsaufwand.

## Entscheidung

- **pg-boss** übernimmt beide Rollen in derselben Postgres-Instanz:
  - **Queue** (`boss.send`/`boss.work`) für klassische Background-Jobs
    (`notifications.send-email`, `pms.night-audit.run-for-hotel`).
  - **Pub/Sub** (`boss.publish`/`boss.subscribe`) als Event-Bus:
    `booking.checked_out` wird von `modules/pms/reservations/service.ts`
    veröffentlicht, `modules/housekeeping/tasks/jobs.ts` abonniert es —
    ohne dass `pms` `housekeeping` kennt.
- Alle Topic-/Queue-Namen sind zentral in `modules/_shared/topics.ts`
  registriert (`EVENTS`, `QUEUES`), damit Publisher und Subscriber nicht
  auseinanderlaufen.
- Der Worker (`worker/index.ts`) ist ein eigenständiger Node-Prozess ohne
  Next.js/React im Pfad — eigenes Deploy-Ziel (Hosting-Entscheidung
  ausdrücklich nicht Teil von Phase 0).
- Verbindung für pg-boss selbst über den Session-Pooler (Port 5432) — pg-boss
  hält eigene, länger lebende Verbindungen für Polling/LISTEN-NOTIFY, die
  nicht zum kurzlebigen Transaction-Pooler-Modell passen.

## Konsequenzen

- Es gibt ab Phase 0 zwei always-on Deploy-Ziele (Next.js-Web-Prozess +
  Worker), nicht nur eines — das muss beim Hosting-Setup eingeplant werden.
- Jeder neue Event/Job-Typ wird zuerst in `topics.ts` registriert, bevor er
  irgendwo publiziert/konsumiert wird.
- pg-boss legt sein eigenes `pgboss`-Schema selbstständig an (`boss.start()`)
  — das ist von unseren eigenen, fachlichen Migrationen in
  `supabase/migrations/` getrennt und wird nicht dort verwaltet.
- Da Postgres selbst der Broker ist, bleibt "nur Postgres" als
  Betriebsabhängigkeit bestehen (Vorgabe #4: kein Lock-in über Supabase
  hinaus, ein Umzug auf eigenes RDS bleibt möglich).

## Verworfene Alternativen

- **Dedizierter Message-Broker** (RabbitMQ, SQS, Redis Streams): mehr
  Funktionsumfang, aber ein zusätzliches System zu betreiben/überwachen —
  unverhältnismäßig für die aktuelle Teamgröße und Lastanforderungen.
- **Nur Postgres LISTEN/NOTIFY ohne pg-boss**: kein Retry, keine
  Persistenz über Verbindungsabbrüche hinweg, keine Scheduling-Fähigkeit —
  müsste großteils selbst nachgebaut werden.
- **Separates Event-Bus-Produkt + separate Job-Queue** (zwei Systeme statt
  eines): pg-boss deckt beide Rollen ab; zwei Systeme für dieselbe
  Aufgabenklasse hätte den Betriebsaufwand verdoppelt, ohne einen konkreten
  Vorteil für diese Projektgröße zu bringen.
