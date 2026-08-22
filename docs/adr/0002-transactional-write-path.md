# 0002 — Transaktionaler Write-Pfad (`executeWrite`)

## Kontext

Ein PMS mit Fiskal-Anspruch (Buchungen, Zahlungen, später RKSV-Signaturkette)
darf nie einen Fachwrite ohne zugehörigen Audit-Log-Eintrag zulassen — sonst
ist die Nachvollziehbarkeit lückenhaft und im Streitfall/Prüfungsfall nicht
belastbar. Das direkte Referenzprojekt (`/Users/mathias/Ticketsytem v3`) löst
Audit-Logging als "best effort" NACH dem eigentlichen Write (Fire-and-Forget)
— für Hotel Tool nicht ausreichend.

Der Supabase-JS-Client kann pro Request nur einen einzelnen PostgREST-Call
absetzen, keine Mehrschritt-Transaktion über mehrere INSERTs hinweg.

## Entscheidung

- `modules/_shared/write.ts#executeWrite()` kapselt: Fachwrite (`mutate()`) +
  Audit-Insert (`modules/audit/service.ts#writeAudit()`) + optionalen
  Event-Insert (`events`-Tabelle) + pg-boss-Publish — alle vier in EINER
  `BEGIN … COMMIT`-Transaktion.
- Dafür ein roher `pg`-Pool (`lib/db/pool.ts`, verbunden über den Supabase
  Transaction-Pooler, Port 6543) statt des Supabase-JS-Clients.
- pg-boss wird über einen kleinen `IDatabase`-Adapter
  (`lib/queue/boss.ts#pgBossDbAdapter()`) angewiesen, sein Insert über
  dieselbe `PoolClient` auszuführen statt über seine eigene interne
  Connection — dadurch ist auch das Event-Enqueue Teil der Transaktion.
- Die Verbindung läuft mit Service-Role-Rechten (RLS wird hier bewusst
  umgangen) — Autorisierung (`assertModuleEnabled()` + `requirePermission()`)
  ist zu diesem Zeitpunkt bereits explizit geprüft (Vorgabe #2).

## Konsequenzen

- Jede mutierende Funktion in `modules/pms/*` (und perspektivisch jedes
  weitere Fachmodul) MUSS über `executeWrite()` laufen — ein direkter
  `client.query('insert …')` außerhalb dieses Helpers wäre ein
  Architektur-Bruch (kein Audit-Eintrag garantiert).
- `DATABASE_URL` muss zwingend auf den Transaction-Pooler zeigen; ein Zeigen
  auf den Session-Pooler oder eine Direktverbindung würde unter Last zu
  Verbindungserschöpfung führen.
- pg-boss' API zum Einreihen innerhalb einer bestehenden Transaktion wurde
  gegen die zum Implementierungszeitpunkt installierte Version (pg-boss
  12.27.0) verifiziert: `SendOptions.db?: IDatabase` wird von `publish()`
  durchgereicht (siehe `node_modules/pg-boss/dist/types.d.ts`). Bei einem
  größeren pg-boss-Versionssprung ist das erneut zu prüfen.
- Für client-generierte Ressourcen (z. B. neue Reservierungen) generiert die
  aufrufende Service-Funktion die UUID selbst (`randomUUID()`) VOR dem
  Insert, damit sie sowohl im Insert als auch im `event.payload` verwendet
  werden kann, ohne dass `executeWrite()` seine Signatur ändern müsste (die
  Event-Payload ist ein statischer Wert, der VOR `mutate()` feststehen muss).
  Das passt zusätzlich zu K6 (Offline-Sync-Constraint: client-generierbare
  UUID als Primärschlüssel).

## Verworfene Alternativen

- **Best-effort-Audit-Log nach dem Write** (wie im Referenzprojekt): würde
  bei einem Absturz zwischen Write und Audit-Insert einen unauditierten
  Fachwrite hinterlassen — für ein PMS mit Fiskal-Anspruch nicht akzeptabel.
- **Zwei getrennte Transaktionen (Fachwrite, dann Audit) mit Kompensations-
  logik bei Fehlern**: unnötig komplex verglichen mit einer einzigen
  Transaktion; bringt keinen Vorteil, da beide ohnehin dieselbe Anfrage
  bedienen.
- **Supabase Postgres Functions/RPCs für den gesamten Write**: hätte die
  Business-Logik in PL/pgSQL statt TypeScript verlagert — widerspricht
  Vorgabe #1 (Geschäftslogik lebt in `/modules`, nicht verstreut).
