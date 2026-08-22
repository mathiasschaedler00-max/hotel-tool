# Hotel Tool – Design-System-Referenz
## Aus dem Claude-Design-Klickprototyp, für die Umsetzung als Tailwind-Design-System

Diese Datei fasst zusammen, was im Claude-Design-Prototyp über mehrere Iterationsrunden erarbeitet wurde: Farbsystem, Zustände, und die Struktur aller 8 Referenz-Screens. Sie ersetzt nicht den visuellen Prototyp selbst (der liegt in Claude Design, Projekt "Hotel OS" / "Design-System und Tap..."), sondern dokumentiert die Design-Entscheidungen textuell, damit Schritt 1 (UI-Aufbau) danach bauen kann, ohne zu improvisieren.

---

## 1. Design-Charakter (Grundhaltung)

- Ruhig, präzise, vertrauenswürdig – Profi-Cockpit, keine Marketing-Landingpage
- Warme, hochwertige Grundstimmung (Off-White/Beige-Töne als Basisfläche), Kupfer/Bernstein als Primär-Akzentfarbe für Hauptaktionen
- Dichte Informationsdarstellung erlaubt (Hotelprofis wollen viel auf einen Blick), aber klare visuelle Hierarchie
- Eine Ausnahme vom Cockpit-Ton: die **Gäste-App** ist bewusst wärmer/einladender, andere Zielgruppe
- WCAG 2.1 AA verpflichtend: Kontraste, Fokus-Zustände, Touch-Ziele min. 44px

## 2. Statusfarben (verbindlich, überall konsistent)

Diese Farb-Bedeutungen dürfen sich zwischen Screens NICHT unterscheiden:

| Farbe | Bedeutung | Wo verwendet |
|---|---|---|
| Grün (Punkt) | Zimmer frei | Belegungsplan, Zimmerliste |
| Blau (Balken, gefüllt) | Belegt / In-House | Belegungsplan-Buchungsbalken |
| Blau (Balken, umrandet/hell) | Reserviert | Belegungsplan-Buchungsbalken |
| Gestrichelter Rahmen | Option (unbestätigte Buchung) | Belegungsplan |
| Gold/Bernstein (Punkt) | Reinigung offen | Zimmerstatus (NICHT für Buchungsbalken – Farbkonflikt vermeiden, siehe unten) |
| Rot (Balken/Rahmen) | Gesperrt / Wartung | Belegungsplan, Housekeeping "Überfällig" |
| Kupfer/Bernstein (Buttons) | Primäraktion | "Neue Buchung", "Fertig", "Senden" etc. |
| Violett | KI-generierter Inhalt (Vorschlag, Hinweis, Antwort) | Überall, wo KI beteiligt ist – IMMER mit Label "KI-VORSCHLAG" o.ä. gekennzeichnet, nie unmarkiert |
| Grün (Button) | Vollständig abgeschlossene Aktion | z.B. Housekeeping-Fertig-Button bei 100% abgehakter Checkliste |

**Wichtige gelernte Lektion aus der Iteration:** Gold/Bernstein darf NICHT gleichzeitig Buchungsstatus UND Zimmerstatus UND Akzentfarbe sein – das hat in einer frühen Version zu Verwechslungen geführt. Farbe = eindeutig eine Bedeutung pro Kontext.

## 3. Rooms-Status – Bestätigung für Schema

Der Belegungsplan nutzt exakt sechs Zimmerstatus, dargestellt als farbiger Punkt vor der Zimmernummer:
**frei · reserviert · belegt · Reinigung · Wartung · gesperrt**

Das deckt sich mit der gemeldeten Schema-Lücke (`rooms.status`) – die Migration auf sechs Werte ist korrekt und notwendig.

## 4. KI-Element-Konvention (gilt für jede KI-Ausgabe im System)

- Jede KI-Ausgabe ist violett markiert und trägt ein sichtbares Label (z.B. "KI-VORSCHLAG", "KI-ANTWORT", "KI-Manager")
- Jede KI-Aktion bietet mindestens: **Annehmen / Anpassen (oder Bearbeiten) / Ablehnen (oder Verwerfen)** – nie automatisches Ausführen ohne Bestätigung
- Ausnahme (bewusst spätere Stufe): KI-Rezeption kann in Stufe 2 einfache Aktionen selbstständig ausführen, aber nur innerhalb definierter Limits – das ist ein späteres Ausbaustadium, keine Phase-0/1-Anforderung

## 5. Die 8 Referenz-Screens

### Screen 1 – Belegungsplan (Tape Chart)
Desktop. Horizontale Zeitachse (Tage) × vertikale Zimmerliste. Buchungen als farbige Balken (Statusfarben s.o.), Drag&Drop zum Verschieben. Kategorie-Filter links (Standard/Komfort/Suite), Legende darunter. Auslastungs-% pro Tag in der Kopfzeile, Heute-Linie sichtbar. Sofortsuche oben ("Gast, Zimmer oder Buchungsnr."). KI-Vorschlagskarte (violett) unten links bei Preisempfehlungen, mit Annehmen/Anpassen/Ablehnen. Klick auf Balken öffnet das Detail-Panel rechts (siehe Screen 2), NICHT direkt den Check-in-Ablauf.

### Screen 2 – Rezeptions-Dashboard
Desktop. Drei Spalten: Ankünfte / Abreisen / In-House, mit Sofortsuche oben. Jede Gast-Karte zeigt Name, Zimmer, Buchungsnr., und – konsistent gelabelt – einen Betrag: "Fällig bei Anreise" (Ankünfte), "Offen bei Abreise" (Abreisen), "Offener Saldo" (In-House). Immer mit Betrag anzeigen, auch 0,00 € (grau), nie das Feld weglassen. Rechts: Heute-Kennzahlen (Auslastung, erwartete Ankünfte, offene Aufgaben, offene Salden) + Liste offener Aufgaben + kompakter KI-Hinweis-Teaser mit Link zur vollständigen KI-Rezeption-Ansicht (Navigation, Badge mit Anzahl).

**Detail-Panel** (rechts, öffnet bei Klick auf Gast/Buchung): Gastname, Buchungsnr., Status-Chip, Zimmer/Nächte/Anreise/Abreise/Rate/Gesamt, KI-Vorschlagskarte falls vorhanden (z.B. Upgrade-Angebot), Verlauf (Zeitstempel + Ereignis), unten Aktionsbuttons je nach Status: bei "Anreise heute" → "Check-in starten" (öffnet den 5-Schritte-Ablauf, Screen 3); bei "Abgereist" → andere Aktionen (Rechnung, ggf. erneut buchen), NICHT "Check-in starten".

### Screen 3 – Check-in-Ablauf (5 Schritte, Desktop, Vollseiten-Modal)
Fortschrittsanzeige oben mit 5 Stationen, Timer rechts oben, "Abbrechen" immer verfügbar.

1. **Gast bestätigen**: Zusammenfassung (Gast, Zimmerkategorie, Nächte, Erwachsene, Kanal, Buchungsnr.), ein Weiter-Button.
2. **Meldedaten**: Ausweis-/Reisepassnummer, Nationalität (Dropdown/Autocomplete, kein Freitext), Geburtsdatum. Falls vorab online gescannt: grüner Bestätigungshinweis "Ausweis vorab gescannt – bitte nur bestätigen" + "Erneut scannen"-Option, Felder vorausgefüllt. Sonst: leere Felder, normale Eingabe. Datenschutz-Hinweistext unter dem Formular (Zweck der Speicherung, gesetzliche Grundlage).
3. **Zimmer zuweisen**: KI-Vorschlag (violett gelabelt) aus der Reservierung übernommen. **Sicherheitsprüfung**: Ist das vorgeschlagene Zimmer laut Housekeeping-Status nicht "Frei", erscheint ein deutlicher Warnblock (rot) mit alternativen freien Zimmern zur Auswahl UND einer bewussten Override-Option "Trotzdem zuweisen (geprüft)". Der Haupt-Weiter-Button ist deaktiviert, bis die Warnung aufgelöst ist. **Wichtig für Backend:** "Trotzdem zuweisen" muss den Housekeeping-Status des Zimmers ebenfalls korrigieren (z.B. auf "Frei"/"In Kontrolle" setzen), nicht nur den Check-in isoliert durchwinken – sonst laufen Belegungsplan und Housekeeping auseinander.
4. **Zahlung/Kaution**: Aufenthalt gesamt, ggf. Zeile "Bereits bezahlt · [Kanal]" (grün, negativ) bei Vorauszahlung über OTA, daraus berechnet "Jetzt fällig". Kaution separat als "Vorautorisierung" gekennzeichnet (gestrichelter Rahmen, Hinweistext "wird reserviert, nicht abgebucht – Freigabe bei Check-out") – technisch getrennter Zahlungsvorgang von der eigentlichen Belastung. Zahlungsart-Auswahl (Karte/Bar) mit sichtbarem aktivem Zustand. Ein Bestätigungs-Button für beides zusammen.
5. **Schlüssel**: Anweisung zum Kodieren der Karte, Zähler "Nx kodiert", Möglichkeit für weitere Karten. Ausweichoption "Kein Kartenleser verfügbar – ohne Kodierung abschließen" (dezent, aber verfügbar). **Abschluss-Zustand nach Kodierung/Abschluss**: grünes Häkchen "Check-in abgeschlossen", Zusammenfassung für den Gast (Zeitraum, WLAN-Zugangsdaten, Frühstückszeiten, Anzahl Schlüsselkarten), zwei Ausgänge: "Zum Gast-Profil" / "Zum Belegungsplan".

**Einstiegspunkte in denselben Ablauf:** (a) Rezeptions-Dashboard, Ankünfte-Karte → Button "Check-in" öffnet direkt; (b) Belegungsplan → Detail-Panel → "Check-in starten", nur bei Status "Anreise heute".

### Screen 4 – Housekeeping (Mobile, 390px)
Zwei Ansichten über Umschalter oben: **"Mitarbeiter"** und **"Leitung · Eskalationen"**.

**Mitarbeiter-Ansicht**: Liste großer Zimmerkarten. Pro Karte: große Zimmernummer, Status-Punkt-Farbe, Priorität-Badge (Hoch/Normal), Reinigungsart als Untertext (ausgeschrieben: "Zwischenreinigung"/"Abreisereinigung"/"Ankunftskontrolle", keine Kurzformen). Aufklappbare Checkliste mit Fortschrittsanzeige (z.B. "1/4"), abgehakte Punkte durchgestrichen. Großer, volle Breite, daumen-erreichbarer **"✓ Fertig"-Button** – unabhängig von der Checkliste bedienbar (kein Zwang, alle Punkte abzuhaken), Farbe kupfer normal / grün wenn Checkliste 100% abgehakt. Nach "Fertig": Karte verschwindet aus der offenen Liste, Zähler oben aktualisiert sich ("X offene Zimmer", "Y erledigt"), kurze Toast-Bestätigung unten.

**Überfällig-Zustand**: Wenn ein Zimmer länger als sein Ziel-Zeitfenster in Bearbeitung ist (Ziel-Zeit ist je nach Reinigungsart unterschiedlich, z.B. Ankunftskontrolle kürzer als Abreisereinigung), färbt sich die Karte rot umrandet mit Warndreieck-Banner: "⚠ Überfällig · Seit X Min. in Bearbeitung".

**Leitungsansicht (Eskalationen)**: Flache Liste aller überfälligen Zimmer, geräteübergreifend (nicht nur ein Handy), sortiert nach Dringlichkeit. Pro Eintrag: Zimmer, Reinigungsart, Verzugszeit vs. Ziel, Priorität, **Name der zuständigen Reinigungskraft** (wichtig, sonst weiß die Leitung nicht, bei wem nachfassen), zwei Buttons "Eskalieren" (Weiterleitung an höhere Ebene, wird rot als "Eskaliert" markiert) und "Nachfassen" (kurze Erinnerung an die zuständige Person) – unterschiedlich beschriftet/mit Tooltip, damit der Unterschied klar ist.

### Screen 5 – Besitzer-Dashboard (Mobile 390px + Desktop 1440px)
**Mobile**: Vier Kennzahlen-Kacheln oben (Umsatz heute, Auslastung, ADR, offene Probleme), darunter Wochenumsatz-Chart (7 Balken, heutiger Tag hervorgehoben), darunter "KI-Manager"-Bereich mit 2–3 Empfehlungskarten (violett, Kategorie-Label wie "Preisstrategie"/"Betrieb"/"Nachfrage", Titel MIT Zeitbezug wenn relevant – z.B. "Wochenendpreis 04.–06. Sept. anheben" statt nur "Wochenendpreis anheben", damit zukunftsbezogene und heutige Empfehlungen nicht verwechselt werden –, Begründungstext, Annehmen/Anpassen/Ablehnen).

**Desktop**: Gleiche Inhalte, Breite genutzt: Kennzahlen-Kacheln vertikal links, Chart groß daneben, KI-Karten in einer Reihe nebeneinander statt gestapelt.

### Screen 6 – Gäste-App Startscreen (Mobile 390px)
Warmer Ton (Abweichung vom Cockpit-Stil, siehe Punkt 1). Persönliche Begrüßung mit Namen. Große Hauptkarte, **kontextabhängig je nach Reisephase**:
- **Vor Anreise**: "Anreise [Datum] – Online-Check-in abschließen" (mit Icon), darunter Schnellzugriffe passend zur Phase: z.B. "Anfahrt & Parken", "Spa buchen" (Vorausbuchung sinnvoll), "Tisch reservieren", "Frühstück hinzufügen" – NICHT Room Service/Housekeeping rufen (macht vor Ort keinen Sinn).
- **Im Hotel** (nach Check-in): "Zimmer öffnen" als Hauptkarte, Schnellzugriffe: Room Service, Spa buchen, Tisch reservieren, Housekeeping rufen.

Icons müssen eindeutig sein (Spa = Lotus/Wellness-Symbol, Housekeeping = Bett/Handtuch-Symbol, nicht mehrdeutige Emojis). "Frage stellen"-Kachel öffnet KI-Chat, mit sichtbarem Label "KI-Assistent · antwortet automatisch" (Transparenzpflicht). "Aktuelle Buchung & Rechnung" dezent unten, erreichbar aber nicht dominant. Branding/Akzentfarbe als austauschbare Variable pro Hotel angelegt.

### Screen 7 – KI-Rezeption Chat-Ansicht (Desktop, 1440px)
Drei Spalten. Links: Posteingang aller Kanäle (WhatsApp/Mail/Web-Chat-Icons), pro Eintrag Gastname, Kanalicon, Nachrichten-Vorschau, Ungelesen-Punkt. Mitte: ausgewählte Konversation als Chatverlauf – Gast-Nachrichten (weiß/hell) und KI-Antworten (violett, gelabelt "KI-ANTWORT") klar unterscheidbar, mit Zeitstempel. Rechts: Gast-Kontext-Panel (wie Detail-Panel aus Screen 1/2: Name, Kanal, Zimmer, aktuelle Buchung, Verlauf, Link "Im Belegungsplan öffnen"). Unten: KI-Antwortvorschlag als eigene violette Karte über dem Eingabefeld mit **Senden / Bearbeiten / Verwerfen**, UND zusätzlich ein separates freies Eingabefeld "Eigene Nachricht schreiben..." mit eigenem Senden-Button für den Fall, dass die Mitarbeiterin ganz ohne KI-Vorschlag antworten will.

---

## 6. Wichtige Verhaltensregeln (übergreifend, gelten für die Implementierung)

1. **Mensch behält immer Kontrolle bei KI** – siehe Abschnitt 4.
2. **Farbkonsistenz** – siehe Abschnitt 2, keine Doppel-Bedeutungen pro Kontext.
3. **Leere/Lade-/Offline-Zustände für jeden Screen mitdenken**, nicht nur den "glücklichen Pfad".
4. **Beträge nie kommentarlos weglassen** – lieber "0,00 €" grau zeigen als das Feld verschwinden zu lassen (verhindert den Eindruck eines Anzeigefehlers).
5. **Jede zerstörerische Aktion** (Storno, Löschen) braucht eine Bestätigung.
6. **Responsive-Grundsatz**: Backoffice-Screens (1, 2, 3, 5-Desktop, 7) primär Desktop/1440px; Mitarbeiter- und Gäste-Screens (4, 5-Mobile, 6) primär Mobile/390px.
7. **Datenkonsistenz zwischen Screens**: Kennzahlen, die auf mehreren Screens auftauchen (z.B. "offene Aufgaben"), müssen aus derselben Datenquelle stammen – das war in der Prototyp-Phase mit Zufallsdaten gelegentlich inkonsistent, ist aber sobald echte Daten aus dem Backend kommen automatisch gelöst, da es dieselbe Quelle ist.

---

*Quelle: Claude-Design-Klickprototyp "Hotel OS", iterativ erarbeitet über 8 Screens hinweg. Der visuelle Prototyp selbst bleibt in Claude Design einsehbar; diese Datei ist die textuelle Referenz für die Tailwind-Umsetzung.*
