# Konzept-Spezifikation: Webbasierter Netzwerk-Simulator für den Informatik-Unterricht

Ein umbaubares Konzept nach dem Vorbild von FILIUS II (Universität Siegen), ausgerichtet auf den Berufsschul-Unterricht Informatik EFZ in der Schweiz. Dieses Dokument ist als Bauplan formuliert und kann einer KI als grundlegende Anforderungsbeschreibung übergeben werden.

---

## 1. Ziel und Zielgruppe

**Produkt:** Ein Simulator für Rechnernetze, der direkt im Browser läuft. Lernende bauen Netzwerk-Topologien auf, konfigurieren Geräte, lösen Verkehr aus und beobachten jeden Schritt auf Paketebene.

**Zielgruppe:** Berufsschülerinnen und Berufsschüler Informatik EFZ (Lehre, ca. 15-25 Jahre), keine Programmier-Vorkenntnisse nötig. Einsatz im Unterricht (Einzelarbeit, Partnerarbeit, Demonstration am Beamer) und zu Hause.

**Didaktisches Leitprinzip:** Entdeckendes Lernen. Die Oberfläche folgt dem Arbeitsprozess "erst planen, dann konfigurieren, anschliessend beobachten".

**Abgrenzung:** Es handelt sich um eine pädagogische Simulation, nicht um einen produktionsnahen Emulator (kein echter Netzwerkstack, keine virtuellen Maschinen). Vereinfachungen sind erlaubt und erwünscht, solange sie transparent sind (z.B. in der Paketansicht vermerkt).

---

## 2. Kernkonzept: Zwei Betriebsmodi

Wie beim Vorbild gliedert sich die Bedienoberfläche strikt in zwei Modi:

### 2.1 Entwurfsmodus (Construction Mode)
- Geräte aus einer Palette per Drag-and-Drop auf eine freie Zeichenfläche (Canvas) setzen.
- Geräte mit der Maus durch Kabel verbinden (Klick auf erstes Gerät, Linie ziehen, Klick auf zweites Gerät).
- Geräte verschieben, benennen, löschen; Kabel entfernen.
- Kein Datenverkehr findet statt. Hier wird nur die Struktur gebaut.

### 2.2 Aktionsmodus (Interaction Mode)
- Der Wechsel zwischen den Modi ist jederzeit möglich (bei Rückkehr in den Entwurfsmodus pausiert die Simulation; Zustände wie ARP-Tabellen bleiben erhalten).
- Doppelt auf ein Gerät klicken öffnet dessen simulierten Desktop.
- Auf diesem Desktop laufen die Client- und Server-Anwendungen (siehe Abschnitt 4).
- Gleichzeitig erscheint eine Paketliste (Packet Log): jedes übertragene Paket wird mit Zeitstempel, Quell-/Zieladresse, Protokoll und Schichten-Detail aufgenommen.

Diese Zweiteilung ist didaktisch zentral: Bauen und Konfigurieren wird vom Experimentieren getrennt, genau wie beim Vorbild.

---

## 3. Geräte-Modell (Bauteile)

| Gerät | Symbol/Typ | Eigenschaften |
|---|---|---|
| Notebook | Endgerät (Client) | 1 Netzwerk-Interface, Desktop mit Client-Anwendungen |
| Rechner (PC) | Endgerät (Server/Client) | 1 Netzwerk-Interface, Desktop mit Client- und Server-Anwendungen |
| Switch | Verteiler | Lernende MAC-Tabelle, mehrere Ports (Standard 4-8, konfigurierbar) |
| Vermittlungsrechner (Router) | Router | 2 oder mehr Interfaces, eigene IP pro Interface, statische Routingtabelle |
| Modem/Vermittlung | WAN-Verbindung | Verbindet zwei sonst getrennte Netze (Vereinfachung: reine Transportstrecke) |

Konfigurationsdialog je Endgerät:
- IPv4-Adresse, Subnetzmaske (mit dezimaler und CIDR-Anzeige, z.B. /24), Standardgateway, DNS-Server
- Modus: statisch oder DHCP (Client bezieht Adresse von einem DHCP-Server im Netz)
- Hinweis, wenn Adresse/Subnetzmaske-Kombination zu keinem gültigen Netz passt (freundliche Fehlermeldung mit Erklärung)

Konfigurationsdialog Router:
- Pro Interface: IP und Subnetzmaske
- Statische Routen: Zielnetz, Subnetzmaske, Gateway, Interface
- Anzeige der aktuellen Routingtabelle als Tabelle

Konfigurationsdialog Switch:
- Ansicht der gelernten MAC-Adressen-Tabelle (Port zu MAC, mit Time-to-live-Verfall)

Kabeltypen:
- Direktes Kabel (Point-to-Point) und Kabel für Switch-Ports
- Optional später: Kabel mit einstellbarer "Beschädigung" (Pakete gehen verloren), didaktisch wertvoll für Fehlersuche-Übungen

---

## 4. Simulierte Protokolle und Anwendungen

Priorisiert nach didaktischem Wert für EFZ; Umfang ist bewusst stufenweise aufgebaut.

### Stufe 1 (MVP)
- **ARP:** Broadcast, ARP-Request/Reply, gelernte ARP-Caches je Interface
- **IPv4:** Adressierung, Subnetting, Weiterleitung nach längstem Präfix-Match, Fehlerfall "Netz nicht erreichbar" (entspricht ICMP «Destination Unreachable»)
- **ICMP:** Ping (echo request/reply), traceroute (TTL-basiert)
- **DHCP:** DORA-Ablauf (Discover, Offer, Request, Acknowledge) als Broadcast-Verkehr sichtbar

### Stufe 2
- **DNS:** Namensauflösung, Zonen-Verwaltung im DNS-Server, Root-Hinweis nicht nötig (rein lokale Hierarchie)
- **UDP/TCP:** Port-Modell, Three-Way-Handshake visualisiert, geordnete, zuverlässige Übertragung bei TCP (vereinfachte Sequenznummern)
- **HTTP:** Webbrowser-Anwendung (vereinfachte URLs, z.B. http://webserver1/index.html), Webserver mit editierbaren HTML-Inhalten

### Stufe 3
- **E-Mail:** SMTP zum Versenden, POP3/IMAP zum Abholen, Postfächer auf dem Mailserver
- **Weitere Werkzeuge:** Ping mit Optionen, Schnittstellen-Diagnose (ipconfig/ifconfig-artige Anzeige am simulierten Desktop)

### Paketanalyse (Kernstück!)
- Klick auf ein Paket in der Paketliste öffnet eine Schichten-Darstellung: Ethernet (Frame) enthält IP (Paket) enthält ICMP/UDP/TCP (Segment) enthält Anwendungsdaten.
- Jede Schicht ist aufklappbar und zeigt alle Felder in menschenlesbarer Form (Quell-MAC, Ziel-MAC, TTL, Quell-IP, Ziel-IP, Ports, Nutzdaten).
- Filter der Paketliste nach Gerät, Protokoll, Richtung.
- Animation optional: Pakete als kleine Punkte, die sichtbar über die Kabel wandern (Geschwindigkeit regulierbar, bis ganz langsam für die Demonstration am Beamer). Ein Zeitlauf-Regler (Play/Pause, Einzelbild) macht Abläufe wie DHCP-Handshake schrittweise erklärbar.

---

## 5. Architektur und Server-Umgebung

### 5.1 Empfohlene Grundarchitektur: vollständig lokal, offline-first
Der Simulator ist eine Single-Page-Application, die als rein statische Dateien ausgeliefert wird (oder gar als einzelne HTML-Datei). Der gesamte Simulationskern läuft im Browser des Nutzers.

```
+------------------------------------------------------------+
|  Browser (jede Lernende einzeln, offlinefähig)              |
|  - UI: Topologie-Editor (SVG oder Canvas)                  |
|  - Simulationskern: diskrete Ereignis-Simulation            |
|  - Persistenz: IndexedDB / Export als .json-Datei           |
+------------------------------------------------------------+
         |
         | (nur beim Server-Betrieb, optional)
         v
+------------------------------------------------------------+
|  Statischer Webserver (Nginx/Caddy) im Docker-Container     |
|  - liefert nur HTML/CSS/JS aus                              |
|  - keine Datenbank, keine API, kein Login                    |
+------------------------------------------------------------+
```

**Simulationskern (eigener Bereich vom UI getrennt):**
- Reine TypeScript-Module ohne DOM-Abhängigkeiten.
- Diskrete Ereignis-Simulation: Jedes Paket ist ein Ereignis mit Zeitstempel; Geräte verarbeiten Ereignisse aus einer Prioritätswarteschlange. Dadurch deterministisch, wiederholbar und testbar.
- Schnittstelle: `simulateStep()`, `getPacketLog()`, `getDeviceState(id)` - die UI fragt Zustände ab, der Kern kennt die UI nicht. Das erlaubt automatisierte Tests ohne Browser.

**Technologie-Empfehlungen (KI soll begründen dürfen, aber hier als Vorgabe):**
- Sprache: TypeScript
- UI-Framework: beliebig schlankes (z.B. Svelte oder React); Editor als SVG
- Keine externen Laufzeit-Abhängigkeiten vom CDN (Offlinefähigkeit, Datenschutz)

### 5.2 Deployment-Varianten

**Variante A: Reines Lokal-Tool (Datenschutz-Optimum)**
- Auslieferung als Ordner mit index.html, direkt vom lokalen Datenträger im Browser öffbar.
- Projekte werden als .json-Datei exportiert/importiert (Austausch per Schul-Share oder E-Mail).
- Kein Server, kein Netzwerkzugriff nötig. Funktioniert auch auf isolierten Prüfungsumgebungen.

**Variante B: Selbst gehosteter Server für Schulen**
- Docker-Compose mit einem Nginx, der die statischen Dateien hinter einem Reverse Proxy (z.B. Caddy mit TLS) ausliefert.
- Innerhalb des Schulnetzes erreichbar, keine Internetabhängigkeit.
- Keine Nutzerkonten, keine Datenbank - alle Daten bleiben im Browser der Lernenden.

**Variante C (optional, spätere Etappe): Klassenraum-Funktionen**
- Kleiner WebSocket-Dienst (Node.js im eigenen Container) für gemeinsame Sessions (Lehrperson demonstriert, Klasse sieht zu).
- Nur auf explizite Anforderung und als getrenntes Add-on, damit die Varianten A und B davon unberührt bleiben.
- Lehrpersonen können Aufgaben als Datei verteilen (Aufgabenformat siehe Abschnitt 6).

---

## 6. Datei- und Aufgabenformat

**Projektdatei (.json, klartextlesbar):**
- `topology`: Geräte (Typ, Name, Position, Interfaces mit IP/Maske), Kabel, MAC-Adressen (deterministisch generiert, z.B. aus Geräte-ID)
- `configuration`: DHCP-Bereiche, DNS-Zonen, Routingtabellen, Webserver-Inhalte, Postfächer
- `meta`: Versionsnummer des Formats (wichtig für spätere Kompatibilität)

**Aufgabendatei (didaktische Erweiterung gegenüber dem Vorbild):**
- Besteht aus einer Projektdatei (Startzustand) plus optionalem `tasks`-Block: Liste von Lernzielen und automatischen Prüfbedingungen (z.B. "Ping von Client1 nach Server1 erfolgreich", "DNS-Anfrage wurde gestellt").
- Der Simulator kann am Ende automatisch prüfen, welche Bedingungen erfüllt sind - ideal für Selbstlernen.
- Lösungsdateien: gleiche Struktur plus erfolgreicher Endzustand.

---

## 7. Datenschutz-Konzept (Schweizer Kontext, revDSG-konform)

Verbindliche Anforderungen, die in jeder Implementation eingehalten werden müssen:

1. **Kein Sammeln von Personendaten:** keine Konten, kein Login, keine E-Mail-Abfrage. Es gibt technisch keinerlei Ort, an dem Personendaten anfallen.
2. **Keine Drittanbieter:** keine externen CDNs, Schriftarten, Analysedienste, Fehler-Reporter oder Kartenmaterial. Alle Assets liegen lokal im Auslieferungsordner. Dadurch entsteht auch bei Offline-Nutzung kein Datenabfluss.
3. **Kein Tracking, keine Cookies** - nicht einmal "harmlose". Persistenz ausschliesslich über IndexedDB oder Datei-Export im Browserprofil der nutzenden Person.
4. **Serverbetrieb (Variante B):** Zugriffsprotokolle des Webservers minimieren oder deaktivieren (access_log off); wenn Protokollierung nötig ist, IPs anonymisieren und kurze Rotation. Betreiber ist die Schule; Da der Dienst nur unveränderliche Dateien ausliefert und keine Personendaten verarbeitet, bleibt der Aufwand für ein Verzeichnis der Verarbeitungstätigkeiten minimal. Haftungsklausel: Der Simulator verarbeitet selbst keine Personendaten - dieser Umstand ist in der Beschreibung festzuhalten.
5. **Optionale Klassenraum-Sessions (Variante C):** Namen sind frei wählbare Spitznamen; Server speichert Session-Daten nur flüchtig im Arbeitsspeicher, kein Auslesen, automatisches Löschen nach Sitzungsende. Datenschutzerklärung ist Aufgabe des Betreibers; dem Tool liegt eine Meldung für die Verantwortlichen bei.
6. **Lizenz-Sauberkeit:** Das Konzept ist eine eigenständige Neuimplementation. Es darf weder Code, Grafiken noch Ressourcen des Originals (GNU GPL v3) kopiert werden. Eigene Symbole und eigene Texte verwenden; im Impressum der selbst gebauten Lösung klar als eigenständiges Projekt ausweisen.

---

## 8. Benutzeroberfläche (Konventionen)

- Sprache Deutsch als Standard, Struktur so angelegt, dass Übersetzungen (FR/IT/EN) einfach ergänzbar sind (alle Texte in separaten Sprachdateien). Für die Schweiz ist Französisch als zweite Sprache besonders sinnvoll.
- Barrierefreiheit: Bedienung komplett mit Tastatur möglich, ausreichende Kontraste, skalierbare Darstellung.
- Geräte-Symbole intuitiv und einheitlich; Farbe markiert Rollen (Endgerät/Verteiler/Vermittler).
- Undo/Redo im Entwurfsmodus.
- Zoombare Zeichenfläche mit "Auf Auswahl zentrieren".
- Dark-Mode optional (Beamerverträglichkeit: helles Schema pflegen).

---

## 9. Umsetzungsplan für die KI (Meilensteine)

| Etappe | Inhalt | Abnahmekriterium |
|---|---|---|
| M1 | Topologie-Editor: Geräte setzen, verbinden, benennen, verschieben; Speichern/Laden als .json | Ein 2-Client-1-Switch-Netz lässt sich bauen, speichern und erneut laden |
| M2 | Simulationskern: diskrete Ereignissteuerung, ARP, IPv4-Zustellung im gleichen Subnetz, Paketliste | Ping zwischen zwei direkt verbundenen Rechnern erscheint mit ARP vor ICMP |
| M3 | Switch (MAC-Lerntabelle), Subnetting, Router mit statischen Routen | Ping über Router zwischen zwei Subnetzen gelingt; Routingtabellen einsehbar |
| M4 | Aktionsmodus mit simuliertem Desktop: Ping-, Traceroute- und DHCP-Anwendungen; Paketdetail-Ansicht mit Schichten | DHCP-Bezug ist im Paketlog als DORA-Folge nachvollziehbar |
| M5 | DNS, TCP/UDP-Ports, HTTP (Browser/Webserver) | URL-Aufruf über Namen funktioniert inklusive sichtbarer Auflösungsschritte |
| M6 | E-Mail (SMTP/POP3/IMAP), Aufgabenformat mit automatischer Prüfung | Eine Musteraufgabe "Netz mit zwei Subnetzen aufbauen" wird korrekt ausgewertet |
| M7 | Deployment: Build als statische Dateien, Docker-Compose, Anleitung für Variante A und B | Der Bericht: Auslieferung auf einem frischen Rechner ohne Internetzugriff nutzbar |

**Teststrategie:** Der Simulationskern wird mit automatisierten Tests geprüft (deterministische Ereignissimulation erlaubt exakte Soll-Paketfolgen). Mindestens je Test: ARP-Zustellung, Broadcast am Switch, Gateway-Fehlerfall, DHCP-Renewal, DNS-Cache-Fehler, längster-Präfix-Match mit zwei Routen.

---

## 10. Prompt-Vorlage für die KI

Der folgende Textblock kann einer KI als Startpunkt übergeben werden:

> Baue eine webbasierte Lernumgebung zur Simulation von Rechnernetzen für den Berufsschul-Unterricht Informatik EFZ. Technik: TypeScript, Simulationskern getrennt von der UI als diskrete Ereignis-Simulation mit Prioritätswarteschlange, Oberfläche als Single-Page-App, alle Assets lokal, keine externen Abhängigkeiten. Funktionsumfang und Details entnimm der Konzept-Spezifikation, die ich beilege. Beginne mit Meilenstein M1 aus Abschnitt 9 und arbeite die Etappen in Reihenfolge ab. Halte nach jedem Meilenstein die Abnahmekriterien testbar ein. Datenschutz-Anforderungen aus Abschnitt 7 sind verbindlich: keine Konten, kein Tracking, keine externen Dienste, Persistenz nur lokal im Browser oder über .json-Export.

---

*Hinweis: Diese Spezifikation basiert auf dem öffentlich dokumentierten Konzept der Lernsoftware Filius/FILIUS II (Universität Siegen) und eigenen didaktischen Ergänzungen. Es handelt sich um eine unabhängige Anforderungsbeschreibung, nicht um eine Kopie der Software.*