# HOTEL OS – MASTERPLAN
## Komplette Architektur + Umsetzung in einer Datei

**Stand der Entscheidungen:**
- Alle Module aus der Gesamtarchitektur werden gebaut
- RAUS endgültig: Immobilienmanagement (24), Versicherungsmanagement (26)
- VERMERKT FÜR SPÄTER (Partner-Integration): Parkplatzmanagement (52), Wäscherei/RFID (53), Transport (23 als Resort-Add-on)
- Doppelungen zusammengelegt: 16+35 (Einkauf), 17+37 (Wartung/CMMS), 18+42 (CRM+Loyalty), 22+40 (MICE), 27+39 (ESG)

---

# TEIL A – DIE ARCHITEKTUR (WAS gebaut wird)

## Schicht 1: Fundament
| Nr | Modul | Inhalt |
|----|-------|--------|
| K1 | Zentraler Datenkern | Hotels, Gebäude, Zimmer, Gäste, Buchungen, Folios, Mitarbeiter, Aufgaben – EINE Datenbasis für alles, Multi-Tenant |
| K2 | Benutzer & Rechte | Rollen: Besitzer, Manager, Rezeption, Housekeeping, Technik, F&B, Spa, Buchhaltung |
| K3 | Event-System | Jede Aktion erzeugt ein Ereignis → Module reagieren automatisch aufeinander |
| K4 | API-Schicht | Alles zuerst als API, Apps sind nur Oberflächen; öffentliche API + Partner-Marktplatz |
| K5 | Audit & KI-Log | Wer/was/wann + jede KI-Entscheidung mit Begründung (Basis für EU AI Act) |
| K6 | Offline & Sync | Lokaler Betrieb bei Internetausfall, automatische Synchronisierung danach |
| K7 | Sicherheit | Verschlüsselung, Backups, 2FA, Zugriffsprotokolle, später ISO 27001/SOC 2 |

## Schicht 2: Verkauf
| Nr | Modul | Inhalt |
|----|-------|--------|
| V1 | Buchungskalender | Zentrale Verfügbarkeits-/Belegungsansicht (Tape Chart) |
| V2 | Booking Engine | Eigene Buchungsstrecke: Suche → Zimmer → Extras → Zahlung → Bestätigung; inkl. Gutschein-Verkauf |
| V3 | Channel Manager | Booking.com, Expedia, Airbnb, Google Hotels; Preis/Verfügbarkeit sync, Doppelbuchungsschutz |
| V4 | Raten-Management | Preispläne, Saisons, Stornoregeln, Overbooking-Logik, Kontingente |
| V5 | Revenue-KI | Preisoptimierung (Nachfrage, Saison, Events, Wetter, Konkurrenz); erst Vorschlag, dann Auto mit Limits |
| V6 | GDS | Sabre/Amadeus/Travelport über Konnektivitätspartner |
| V7 | Dynamic Packaging | Zimmer + Extras/Erlebnisse als automatische Pakete |
| V8 | Sales B2B | Firmenraten, Kontingente, Reiseveranstalter-Verträge, Angebote |

## Schicht 3: Betrieb
| Nr | Modul | Inhalt |
|----|-------|--------|
| B1 | PMS-Kern | Check-in/out, Zimmerzuteilung, Folio, Gruppen-/Firmenbuchungen; **Sicherheitsprüfung bei Zuteilung: Warnung/Sperre, wenn ein Zimmer noch nicht als "Frei" (sauber) markiert ist** |
| B2 | Night Audit | Tagesabschluss, No-Show-Verbuchung, Berichte, Datumswechsel |
| B3 | Fiskalisierung | TSE (DE) / RKSV (AT) / Fiskalpartner je Land – gesetzeskonforme Belege |
| B4 | Rezeptions-Oberfläche | Tägliche Arbeitsmaske mit KI-Unterstützung (Vorschläge, Gastinfo) |
| B5 | Aufgaben-System | Zentrale Drehscheibe: jede Anfrage/Störung/Aufgabe an die richtige Abteilung |
| B6 | Housekeeping | Reinigungslisten, Prioritäten, Checklisten, Qualität; Checkout→Reinigung→verkaufbar automatisch; **Fristen-Überwachung: Zimmer, die zu lange auf "Reinigung" stehen, werden automatisch als "Überfällig" markiert und an Housekeeping-Leitung eskaliert** |
| B7 | Wartung & CMMS | Reaktiv (Tickets) + vorbeugend (PPM-Pläne) + Anlagenregister + Lebenszyklus |
| B8 | Restaurant/Bar-POS | Bestellungen, Zimmerbuchung, Tischreservierung, Kassenanbindung fiskal |
| B9 | Spa & Wellness | Behandlungen, Therapeuten, Räume, Termine, Produkte, Folio-Verrechnung |
| B10 | MICE/Event/Bankett | Anfrage→Angebot→Vertrag→Planung (Räume, Catering, Technik, Personal)→Abrechnung |
| B11 | Einkauf & Lager | Lieferanten, Bestellungen, Freigaben, Bestände, Verbrauch, KI-Nachbestellung |
| B12 | Kurtaxe & Meldewesen | Automatische Kurtaxe-Berechnung + behördliche Gästemeldung je Land/Stadt |
| B13 | Dokumentenmanagement | Verträge, Zertifikate, Genehmigungen; KI liest und erkennt Fristen |
| B14 | Notfallmanagement | Notfallpläne, Alarmierung, Panic-Button-Integration (Hardware über Partner) |

## Schicht 4: Menschen
| Nr | Modul | Inhalt |
|----|-------|--------|
| M1 | Mitarbeiterverwaltung | Profile, Abteilungen, Qualifikationen, Verträge, Dokumente |
| M2 | Dienstplanung | Manuell zuerst, dann KI-Planung nach Auslastungsprognose |
| M3 | Recruiting & Onboarding | Bewerbungen, Bewertung, Gespräche, Einarbeitung, Schulungen |
| M4 | Payroll-Schnittstelle | Export zu Lohnabrechnung (DATEV/BMD/Partner) – NIE selbst bauen |
| M5 | Mitarbeiter-App | Schichten, Aufgaben, Meldungen, Nachrichten |

## Schicht 5: Gäste
| Nr | Modul | Inhalt |
|----|-------|--------|
| G1 | CRM-Gästeprofil | Historie, Vorlieben, Ausgaben, Beschwerden – ein Profil für alle Module |
| G2 | Online-/Kiosk-Check-in | Web, App und Lobby-Terminal; Ausweis-Upload DSGVO-konform |
| G3 | Gäste-App | Buchen, bezahlen, Tür öffnen (Partner-Hardware), Services bestellen, Fragen |
| G4 | KI-Rezeption | Chat/WhatsApp/Mail/Telefon, mehrsprachig; Stufe 1 Vorschläge, Stufe 2 selbstständig mit Limits |
| G5 | Loyalty-Programm | Punkte, Statusstufen (Bronze/Silber/Gold), Vorteile, Gutscheine – auf CRM aufgesetzt |
| G6 | Bewertungsmanagement | Google/Booking/Tripadvisor-Monitoring, KI-Antworten, Trend-Analyse |
| G7 | ID-Verifizierung & Betrugsschutz | Ausweisprüfung (SDK-Partner), Zahlungsrisiko, Chargeback-Abwehr |
| G8 | Barrierefreiheits-Infos | Barrierefreie Zimmer verwalten und buchbar filtern; digitale Zugänglichkeit als Standard |

## Schicht 6: Geld & Analyse
| Nr | Modul | Inhalt |
|----|-------|--------|
| F1 | Finance | Rechnungen, Zahlungen, Steuern, Debitoren (Firmenrechnung, offene Posten, Mahnwesen) |
| F2 | Buchhaltungs-Export | DATEV/BMD/Steuerberater-Schnittstellen |
| F3 | Business Intelligence | Dashboards (Umsatz, Auslastung, Kosten, GOPPAR), Prognosen, Budgetvergleich |
| F4 | Energie & ESG | Verbräuche (Partner-Sensorik), CO₂, Abfall; ESG-Berichte und Zertifikats-Vorbereitung |

## Schicht 7: KI & Zukunft
| Nr | Modul | Inhalt |
|----|-------|--------|
| Z1 | KI Hotel Manager | Übergreifende Empfehlungs-KI: Preise, Personal, Kosten, Probleme |
| Z2 | Marketing-Automation | Newsletter + Angebots-Automation aus CRM; Social-Media-Erstellung als Add-on |
| Z3 | MCP / KI-Agenten-Buchbarkeit | Hotel für externe KI-Assistenten lesbar und buchbar (MCP-Server, Schema.org-Daten) |
| Z4 | EU AI Act Compliance | Transparenz-Hinweise, KI-Entscheidungs-Protokolle, Human-Override-Doku |
| Z5 | KI-Betrugsschutz | Voice-Cloning-Erkennung, Fake-Review-Erkennung, Social-Engineering-Schulung |
| Z6 | Franchise/Ketten | Markenstandards, Audits, Multi-Property-Konsolidierung (erst bei Ketten-Kunden) |

## Grundprinzipien (gelten überall)
1. **Mensch behält Kontrolle**: Jede KI beginnt als Vorschlag; Auto-Modus nur mit Limits und nach bewiesener Trefferquote
2. **Nicht selbst bauen, nur integrieren**: Kartennetze, Banken, Fiskal-Signatur, Lohnabrechnung, Türschlösser, Klimatechnik, GDS-Zertifizierung, Ausweis-Prüf-KI, IoT-Sensorik, KI-Grundmodelle
3. **Barrierefreiheit (WCAG 2.1 AA)** und **DSGVO** in jeder Oberfläche von Anfang an
4. **Offline-fähig**: Check-in/out, Kalender, Aufgaben funktionieren ohne Internet weiter

---

# TEIL B – DIE UMSETZUNG (WANN und in welcher REIHENFOLGE)

## PHASE 0 – Fundament (Monat 1–3)
**Baut: K1–K7 als Grundgerüst. Nichts Sichtbares, alles Entscheidende.**

Schritte:
1. Datenmodell final definieren (Hotel, Zimmer, Gast, Buchung, Folio, Mitarbeiter, Aufgabe, Zahlung, Event)
2. Multi-Tenant-Architektur + Mandantentrennung
3. Benutzer/Rollen/Rechte (K2)
4. Event-Bus aufsetzen (K3): "CheckOut passiert" → System kann reagieren
5. API-first-Gerüst (K4): jede Funktion als API-Endpunkt
6. Audit-Log + KI-Entscheidungslog (K5) von Anfang an in jede Schreiboperation
7. Offline-/Sync-Konzept designen (K6) – noch nicht voll bauen, aber Architektur festlegen
8. Sicherheits-Basis (K7): Verschlüsselung, Backups, 2FA
9. **Modul-Schalter-System (Entitlements)**: Tabelle "Hotel X hat Module Y aktiv"; jedes Modul prüft beim Aufruf seine Freischaltung; nicht gebuchte Module sind komplett unsichtbar (siehe Teil D)
10. Design-System für alle Oberflächen festlegen (siehe Design-Prompt-Datei) inkl. Barrierefreiheits-Standard

✅ **Meilenstein:** Test-Hotel mit Zimmern, Dummy-Gast und Dummy-Buchung existiert komplett über die API.

## PHASE 1 – PMS-Kern: das lauffähige Hotel (Monat 3–9)
**Baut: V1, B1, B2, B3, B4, F1-Basis. Parallel sofort starten: Booking.com-Zertifizierung beantragen (dauert Monate!).**

Schritte in exakter Reihenfolge:
1. Zimmerverwaltung + Zimmerstatus. **Wichtig, zwei getrennte Konzepte, nicht ein Feld:**
   - **Zimmer-Zustand** (gehört auf `rooms.status`, physischer Zustand des Zimmers, unabhängig von Buchungen): frei / Reinigung / Wartung / gesperrt
   - **Buchungsstatus** (gehört auf `reservations.status`, unabhängig vom Zimmer): reserviert / belegt (In-House) / abgereist / storniert
   
   Ein Zimmer kann z. B. "frei" (Zimmer-Zustand) UND gleichzeitig für nächste Woche "reserviert" (Buchungsstatus) sein – beides gilt gleichzeitig, deshalb NICHT in ein einziges Dropdown/Feld packen. Im Belegungsplan wird das entsprechend getrennt dargestellt: Zimmer-Zustand als Punkt vor der Zimmernummer, Buchungsstatus als Balken im Kalender. Der spätere Überbuchungsschutz (Phase 1, Schritt 3) baut auf den Buchungszeiträumen auf, nicht auf einem Zimmerstatus-Wort – eine Vermischung hier würde Schritt 3 auf falschem Fundament aufbauen.
2. Buchungskalender / Tape Chart (V1)
3. Reservierungen manuell: anlegen, ändern, verschieben, stornieren, Gruppen
4. Check-in / Check-out + Zimmerzuteilung (B1)
5. Folio: Leistungen aufs Zimmer, Splitten, Rechnungserstellung (F1-Basis)
6. Zahlungsanbindung über PSP-Partner (Adyen/Stripe) – Karte, Vorauszahlung, Kaution
7. **Fiskalisierung** (B3) über Fiskal-Partner (z.B. fiskaly): TSE/RKSV-konforme Belege – PFLICHT vor erstem echten Kunden
8. **Night Audit** (B2): Tagesabschluss, No-Shows, Tagesberichte, Datumswechsel
9. Rezeptions-Oberfläche (B4): eine Maske für den Tagesbetrieb
10. Debitoren-Basis: Rechnung an Firma, offene Posten
11. Buchhaltungs-Export Basis (F2): DATEV-kompatible Ausgabe

✅ **Meilenstein:** 1–2 Pilothotels fahren einen kompletten Monat ihren echten Betrieb fehlerfrei.

## PHASE 2 – Verkaufen: Booking Engine + Kanäle (Monat 9–14)
**Baut: V2, V3, V4 + Migrationstool + öffentliche API.**

Schritte:
1. Raten-Grundlogik (V4): Preispläne, Saisonpreise, Stornobedingungen, Overbooking-Regeln
2. Booking Engine (V2): komplette Buchungsstrecke inkl. Extras und Zahlungen
3. Gutschein-System: Wertgutscheine online verkaufen und einlösen
4. Channel Manager (V3) in dieser Kanal-Reihenfolge: Booking.com → Expedia → Airbnb → Google Hotels
5. Automatik: OTA-Buchung → Kalender → Gastprofil → Info an Team – ohne manuelle Doppeleingabe
6. **Migrationstool**: Import aus Opera/Protel/Mews/Excel (Gäste, zukünftige Buchungen, Raten) – ohne das wechselt niemand
7. **Öffentliche API dokumentieren und freigeben** – Partner können andocken, was du noch nicht hast

✅ **Meilenstein:** Eine echte Booking.com-Buchung läuft bis zur fiskalisierten Rechnung komplett automatisch durch.
➡️ **AB HIER VERKAUFEN.** Erste zahlende Kunden onboarden, parallel Phase 3 bauen.

## PHASE 3 – Betrieb digitalisieren (Monat 14–18)
**Baut: B5, B6, B7-reaktiv, M1, M2-manuell, M5.**

Schritte:
1. Aufgaben-System (B5) zuerst – die Drehscheibe für alles Folgende
2. Housekeeping (B6): Checkout-Event → Reinigungsaufgabe → fertig → Zimmer verkaufbar (erster Automatisierungs-Loop); **plus Fristen-Logik: Zeitstempel bei Aufgabenstart, automatische "Überfällig"-Markierung nach definierter Dauer, Eskalations-Ansicht für Housekeeping-Leitung**
3. Wartung reaktiv (B7): melden → Ticket → zuweisen → erledigt
4. Mitarbeiterverwaltung (M1) + manuelle Dienstplanung + Urlaub (M2 Stufe 1)
5. Mitarbeiter-App (M5): Schichten, Aufgaben, Meldungen

✅ **Meilenstein:** Ein Hotel arbeitet komplett papierlos über das System.

## PHASE 4 – Gast-Schicht (Monat 18–24)
**Baut: G1, G2, G3, G4-Stufe1, G6, G7-Basis, G8.**

Schritte:
1. CRM-Gästeprofil ausbauen (G1): Historie, Vorlieben, Ausgaben
2. Online-Check-in (G2): Web zuerst, Ausweis-Upload verschlüsselt, Zahlung vorab
3. Gäste-App (G3): buchen, bezahlen, Anfragen; Türöffnung sobald Schloss-Partner integriert
4. Kiosk-Modus (G2) für die Lobby
5. KI-Rezeption Stufe 1 (G4): Website-Chat + WhatsApp + Mail; beantwortet Fragen, JEDE Aktion nur als Vorschlag an Mitarbeiter
6. Bewertungsmanagement (G6) mit KI-Antwortvorschlägen
7. ID-Verifizierung (G7): Ausweis-Prüf-SDK + Zahlungsrisiko-Score
8. Barrierefreie Zimmer als buchbares Merkmal (G8)

✅ **Meilenstein:** 30 %+ digitale Check-ins; KI beantwortet 50 %+ der Anfragen ohne Mitarbeiter.

## PHASE 5 – Intelligenz (Monat 24–30)
**Baut: F3, V5, M2-KI, Z1, G4-Stufe2. Braucht die Daten aus Phase 1–4.**

Schritte:
1. Business Intelligence (F3) ZUERST: Dashboards, Berichte, Prognose-Basis – KI braucht saubere Historie
2. Revenue-KI (V5) Stufe 1: Preisvorschläge, Manager bestätigt
3. Revenue-KI Stufe 2: Auto-Modus innerhalb definierter Grenzen (z.B. ±15 %)
4. KI-Dienstplanung (M2 Stufe 2): Personalbedarf aus Prognose, Planvorschläge
5. KI Hotel Manager (Z1): tägliche Empfehlungen über alle Bereiche
6. KI-Rezeption Stufe 2 (G4): einfache Buchungen/Änderungen selbstständig mit Limits; Telefon-KI aktivieren
7. EU AI Act-Modul aktivieren (Z4): Transparenzhinweise + Berichte aus den seit Phase 0 gesammelten Logs (Pflicht ab 08/2026)

✅ **Meilenstein:** Messbarer RevPAR-Anstieg bei Pilothotels – das Hauptverkaufsargument.

## PHASE 6 – Ausbau nach Kundensegment (Monat 30–48, nach Kundenbedarf priorisieren)
**Baut in empfohlener Reihenfolge:**
1. Restaurant/Bar-POS (B8) inkl. Fiskal-Kasse und Zimmerbuchung
2. Kurtaxe & Meldewesen (B12): DACH zuerst, dann weitere Länder über Connector-Partner
3. Einkauf & Lager (B11): hängt am POS-Verbrauch und Finance
4. Loyalty (G5) auf dem CRM aufsetzen
5. MICE/Event/Bankett (B10) – eigenes Großprojekt, erst mit passenden Kunden
6. Sales B2B (V8): Firmenraten, Kontingente, TO-Verträge
7. Spa & Wellness (B9) für Resort-Kunden
8. CMMS/PPM voll (B7 Ausbau): Anlagenregister, Wartungspläne, Lebenszyklus-KI
9. Recruiting/Onboarding (M3) + Payroll-Schnittstellen (M4)
10. Dokumentenmanagement (B13) mit Fristen-KI
11. Energie & ESG (F4): Berichte selbst, Sensorik über Partner
12. GDS (V6) über Konnektivitätspartner
13. Dynamic Packaging (V7)
14. Marketing-Automation (Z2): Newsletter + CRM-Angebote; Social-Media als Add-on
15. Notfallmanagement (B14): Pläne + Panic-Button-Partner

## PHASE 7 – Zukunfts-Layer (parallel ab Phase 5, fortlaufend)
1. **MCP / KI-Agenten-Buchbarkeit (Z3)** – FRÜH machen: technisch klein dank API-first, kaum Konkurrenz, stärkste Differenzierung. MCP-Server auf die Booking-API + Schema.org-Daten für jedes Hotel veröffentlichen
2. KI-Betrugsschutz (Z5): Voice-Verifikation in Telefon-KI, Fake-Review-Erkennung in G6, Team-Schulung
3. Cybersecurity-Ausbau (K7): Pen-Tests, ISO 27001/SOC 2 (Pflicht für Ketten-Kunden)
4. Franchise/Ketten-Modul (Z6) bei ersten Gruppen-Kunden
5. **Vermerkt für später**: Parkplatz-Partner-Integration, Wäsche-RFID-Partner, Transport-Add-on für Resorts

---

# TEIL C – DIE 7 EISERNEN REGELN

1. **Pilothotels vor Perfektion** – ab Phase 1 mit 1–2 echten Hotels; ihre Probleme bestimmen die Prioritäten
2. **Booking.com-Zertifizierung am ersten Tag von Phase 1 beantragen** – sonst blockiert sie Phase 2
3. **Nie selbst bauen** (siehe Grundprinzip 2) – immer Partner
4. **Jede KI startet als Vorschlag** – Auto-Modus nur mit Limits nach bewiesener Trefferquote
5. **Migrationstool ist Verkaufsvoraussetzung** – ab Phase 2 fester Bestandteil
6. **Offene API ab Phase 2 veröffentlichen** – Partner füllen deine Lücken, statt Kunden zu kosten
7. **"Fertig" = ein echtes Hotel nutzt es im Alltag** – nicht: der Code kompiliert

---

# TEIL D – MODULARITÄT & PREISMODELL
## "Jedes Hotel zahlt nur, was es nutzt"

### D1. Das Schalter-System (Entitlements)
- Im Datenkern (Phase 0, Schritt 9) liegt pro Hotel die Liste der aktiven Module
- Jedes Modul prüft bei jedem Aufruf seine Freischaltung
- Nicht gebuchte Module sind **komplett unsichtbar** – keine toten Buttons, keine gesperrten Menüpunkte
- Module sind im System selbst an-/abschaltbar (Self-Service), inkl. 30-Tage-Testphase pro Modul
- Architektur-Grundsatz ab Phase 0: Das System muss ohne jedes Wahlmodul vollständig funktionieren

### D2. Drei Kategorien von Modulen

**Kategorie 1 – Pflicht-Kern (nie abschaltbar, Basispreis):**
Datenkern, Benutzer/Rechte, PMS-Basis (Kalender V1, Check-in/out B1, Folio), Zahlungen, Night Audit (B2), Fiskalisierung (B3), Aufgaben-System (B5), Sicherheit/DSGVO (K7). Ohne diese: kein Hotelsystem bzw. rechtswidrig.

**Kategorie 2 – Frei abschaltbar (keine Voraussetzungen außer Kern):**
Housekeeping (B6), Wartung (B7), POS (B8), Spa (B9), MICE (B10), Kurtaxe (B12), Dokumente (B13), Notfall (B14), Mitarbeiterverwaltung (M1), Mitarbeiter-App (M5), CRM (G1), Online-Check-in (G2), Gäste-App (G3), Bewertungen (G6), ID-Verifizierung (G7), BI (F3), ESG (F4), Marketing (Z2), Booking Engine (V2), Channel Manager (V3), Raten (V4), Sales B2B (V8).

**Kategorie 3 – Abschaltbar mit Abhängigkeiten:**
| Modul | benötigt |
|-------|----------|
| Revenue-KI (V5) | Raten-Management (V4) |
| Channel Manager (V3) / GDS (V6) | Raten-Management (V4) |
| Dynamic Packaging (V7) | Booking Engine (V2) |
| Loyalty (G5) | CRM (G1) |
| KI-Rezeption (G4) | CRM (G1) + Aufgaben (B5) |
| KI-Dienstplanung (M2 Stufe 2) | Mitarbeiterverwaltung (M1) + BI (F3) |
| KI Hotel Manager (Z1) | BI (F3) |
| Einkauf-Automatik (B11 KI-Teil) | POS (B8); Einkauf manuell geht ohne |
| Recruiting (M3) / Payroll (M4) | Mitarbeiterverwaltung (M1) |
| MCP-Buchbarkeit (Z3) | Booking Engine (V2) + Raten (V4) |
| KI-Betrugsschutz (Z5) | jeweils das geschützte Modul (G4/G6/G7) |

Regeln im Schalter-System:
- Aktivieren eines Moduls mit Abhängigkeit → System bietet an, die Voraussetzung mitzuaktivieren
- Deaktivieren einer Voraussetzung → abhängige Module werden mit Warnung mit-deaktiviert
- Daten bleiben bei Deaktivierung erhalten (Reaktivierung jederzeit ohne Verlust)

### D3. Preisstruktur
- **Basispaket** (Pflicht-Kern + Booking Engine + 1 OTA-Kanal): Grundpreis pro Zimmer/Monat
- **Wahlmodule**: je eigener Monatspreis pro Zimmer oder Flatrate je Modul
- **KI-Module** ggf. mit Nutzungsanteil (z.B. KI-Rezeption nach Konversationsvolumen)
- **Pakete** als Vorauswahl (frei anpassbar):
  - *Boutique*: Basis + Housekeeping + CRM + KI-Rezeption + Bewertungen
  - *Resort*: Boutique + Spa + POS + Gäste-App + Dynamic Packaging
  - *Business*: Basis + Debitoren-Ausbau + MICE + Sales B2B + GDS
  - *Kette*: alles + Franchise (Z6) + BI-Vollausbau + ISO-Sicherheitspaket
- Modul-Testphase: 30 Tage kostenlos, danach zahlen oder automatische Deaktivierung (Daten bleiben)

### D4. Strategische Option für später (vermerkt)
Einzelne Module als **Standalone-Produkte für Hotels mit fremdem PMS** verkaufen (KI-Rezeption, Bewertungsmanagement, Revenue-KI) – als Einstieg, der später zum Wechsel aufs volle Hotel OS führt. Voraussetzung: Schnittstellen zu Fremd-PMS (Mews/Apaleo/Opera). Entscheidung frühestens nach Phase 5.

---

# TEIL E – TECH-STACK (ENTSCHIEDEN)

## E1. Der Stack
| Bereich | Technologie | Begründung |
|---------|-------------|------------|
| Sprache | **TypeScript** (überall) | Ein Ökosystem für Backend, Web und Apps; größter Entwicklerpool |
| Web-Framework | **Next.js** | Rezeption, Manager, Booking Engine, Admin – alles als Web-App |
| Datenbank/Backend | **Supabase** (= PostgreSQL + Auth + Storage + Realtime) | Postgres als Herzstück; RLS = eingebaute Mandantentrennung (Multi-Tenant, Phase 0); Auth/Storage/Realtime fertig statt selbst gebaut |
| Styling | **Tailwind CSS** | Passt zum Design-System aus dem Design-Prompt |
| Job-Queue / Event-Bus | **pg-boss** (Jobs direkt in Postgres) | Night Audit, Channel-Sync, Mails, Event-Verarbeitung – ohne Extra-Infrastruktur; erfüllt K3 für den Start |
| Mobile (ab Phase 3/4) | **React Native + Expo** | Mitarbeiter- und Gäste-App, gleiches TypeScript, gleiche Supabase-Anbindung |
| Offline (K6) | Lokale SQLite + Sync-Schicht (z.B. WatermelonDB/PowerSync) | Rezeption/Housekeeping arbeiten bei Internetausfall weiter |
| Monitoring | Sentry (Fehler) + Uptime-/Metrik-Monitoring | Mission-Critical: Probleme sehen, bevor der Kunde anruft |
| CI/CD | GitHub + GitHub Actions | Jeder Commit getestet, Deployment auf Knopfdruck |
| Hosting | Supabase **Region Frankfurt (EU)** + Vercel/Cloud für Next.js | DSGVO-Argument im DACH-Vertrieb |

## E2. Die vier verbindlichen Auflagen (nicht verhandelbar)
1. **Eigene Modul-Schicht**: Geschäftslogik liegt in klar getrennten Modulen (`/modules/pms`, `/modules/housekeeping` … entsprechend Teil A). Next.js-Routen rufen Module nur auf – niemals Logik direkt in Routen/Komponenten. Nur so funktioniert das Schalter-System (Teil D) sauber.
2. **Alle Schreibzugriffe über die API-Schicht** – niemals direkt vom Browser in Supabase schreiben. Grund: Audit-Log (K5), Entitlement-Prüfung (Teil D), Fiskal-Logik (B3) hängen an der API. RLS ist die zweite Verteidigungslinie, nicht die einzige.
3. **pg-boss ab Phase 0** als Job-Queue und Event-Bus: Night Audit, Channel-Manager-Sync, Mail-Versand, Event-Verarbeitung laufen als Hintergrund-Jobs – nie im Request des Nutzers.
4. **Supabase-Region Frankfurt** und Postgres-Portabilität wahren (keine Supabase-Spezialfeatures, die einen späteren Umzug auf eigenes AWS/RDS verhindern). Exit-Pfad bleibt offen.

## E3. Architekturform
**Modularer Monolith** – ein Deployment, intern streng nach Modulen getrennt, Kommunikation über Events und definierte Schnittstellen. KEINE Microservices am Anfang. Einzelne Module (z.B. Channel-Sync, KI-Rezeption) können später herausgelöst werden, wenn die Last es verlangt.

## E4. Partner-Dienste (per API angebunden, nie selbst gebaut)
- Zahlungen: **Adyen oder Stripe**
- Fiskalisierung: **fiskaly** (TSE DE / RKSV AT)
- KI-Modelle: **API-basiert (Anthropic/OpenAI) hinter eigener Abstraktionsschicht** – Modellwechsel jederzeit möglich; alle KI-Aufrufe laufen durch diese Schicht und erzeugen KI-Logs (K5)
- E-Mail: Postmark/SES · SMS/Telefon: Twilio · WhatsApp: WhatsApp Business API
- Ausweisprüfung: SDK-Partner (z.B. Microblink)
- Türschlösser/IoT/Sensorik: Hersteller-APIs

## E5. Skalierungspfad
- Start bis ~100+ Hotels: obiger Stack unverändert – Multi-Tenant-Postgres trägt das problemlos
- Wachstum: Lese-Replikate, Redis-Cache für Verfügbarkeitsabfragen der Booking Engine, Worker horizontal skalieren
- Später (viele hundert Hotels): Umzug auf eigenes Cloud-Postgres möglich (Auflage E2.4 hält den Weg frei); lastintensive Module aus dem Monolithen herauslösen (E3)
