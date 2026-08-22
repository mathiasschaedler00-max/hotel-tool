# 0004 — Entitlements: deaktivierte Module liefern 404, nicht 403

## Kontext

Hotel Tool ist modular schaltbar pro Hotel (`hotel_modules.enabled`, "Teil D"
im Masterplan, hier noch nicht im Detail spezifiziert). Ein deaktiviertes
Modul soll für ein Hotel **komplett unsichtbar** sein — auch, dass der
Endpunkt überhaupt existiert, ist Information, die ein Wettbewerber oder ein
Mitarbeiter mit falscher Erwartungshaltung nicht bekommen soll ("gibt es das
Feature X grundsätzlich, nur bei uns abgeschaltet, oder gibt es das gar
nicht?").

## Entscheidung

- `assertModuleEnabled(hotelId, key)` wirft `ModuleDisabledError`.
- `modules/_shared/response.ts#err()` übersetzt `ModuleDisabledError`
  IMMER zu HTTP **404** ("Not found"), nie zu 403 ("Forbidden").
- `assertModuleEnabled()` wird als **erster Schritt** in jeder
  Modul-Service-Funktion aufgerufen — **vor** `requirePermission()`. Wäre die
  Reihenfolge umgekehrt, würde ein 403 (RBAC) vs. 404 (Modul aus) selbst
  schon verraten, ob das Modul grundsätzlich existiert, unabhängig vom
  HTTP-Status — die Timing-/Statuscode-Differenz wäre der Leak.
- Die Fehler-Response bleibt clientseitig generisch (`{ code: "not_found",
  message: "Not found" }`) — der `moduleKey` aus `ModuleDisabledError.details`
  wird ausschließlich server-seitig geloggt, nie an den Client zurückgegeben.

## Konsequenzen

- Jede neue Modul-Funktion MUSS mit `assertModuleEnabled()` beginnen, bevor
  irgendeine andere Prüfung oder ein DB-Zugriff passiert.
- Ein Code-Review-Kriterium: taucht `requirePermission()` vor
  `assertModuleEnabled()` auf, ist das ein Bug, kein Stilfehler.
- Clientseitige Fehlerbehandlung darf sich nicht auf Unterscheidung
  "404 wegen echtes Nicht-Vorhandensein" vs. "404 wegen deaktiviertem Modul"
  verlassen — beide sehen für den Client identisch aus, by design.

## Verworfene Alternativen

- **403 Forbidden für deaktivierte Module**: naheliegend, aber verrät, dass
  der Endpunkt grundsätzlich existiert — widerspricht dem Ziel "komplett
  unsichtbar" aus Teil D.
- **Generische Middleware in `proxy.ts`, die Modul-Status pro Route prüft**:
  Modul-Aktivierung ist pro Hotel in der DB hinterlegt, nicht statisch aus
  dem Pfad ableitbar, und der Cookie-basierte "aktive Hotel"-Kontext wird
  ohnehin erst in `getModuleContext()` aufgelöst — eine Prüfung auf
  Proxy-Ebene hätte dieselbe DB-Abfrage doppelt gemacht, ohne den
  eigentlichen 403-vs-404-Ordering-Bug zu verhindern (der entsteht innerhalb
  der Modul-Funktion, nicht davor).
