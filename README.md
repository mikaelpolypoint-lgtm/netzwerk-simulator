# Netzwerk-Simulator

[![CI](https://github.com/mikaelpolypoint-lgtm/netzwerk-simulator/actions/workflows/ci.yml/badge.svg)](https://github.com/mikaelpolypoint-lgtm/netzwerk-simulator/actions/workflows/ci.yml)

Webbasierter Simulator für Rechnernetze im Informatik-Unterricht (Informatik EFZ). Lernende bauen Topologien auf, konfigurieren Geräte und beobachten den Verkehr auf Paketebene. Läuft vollständig im Browser, offline, ohne Konten und ohne externe Dienste. Oberfläche auf Deutsch und Englisch, mit hellem und dunklem Design.

Die vollständige Anforderungsbeschreibung steht in [docs/konzept.md](docs/konzept.md).

## Sofort loslegen

```bash
git clone https://github.com/mikaelpolypoint-lgtm/netzwerk-simulator.git
```

Dann **`release/netzwerk-simulator.html`** doppelklicken – fertig, ohne Installation und ohne Internet. Alle Wege (Datei verteilen, Schulserver mit Docker, selbst bauen) beschreibt [docs/installation.md](docs/installation.md), dazu die [Webversion mit Node.js auf Plesk](docs/plesk.md) (Sessions mit Code, Klassen, Rückmeldungen, Admin-Konsole) und die [Desktop-Version für Windows, macOS und Linux](docs/desktop.md).

## Stand

| Etappe | Inhalt | Status |
|---|---|---|
| M1 | Topologie-Editor, Speichern/Laden als .json | ✅ |
| M2 | Simulationskern, ARP, IPv4 im gleichen Subnetz, Paketliste | ✅ |
| M3 | Switch-Lerntabelle, Subnetting, Router mit statischen Routen | ✅ |
| M4 | Aktionsmodus mit Desktop: Ping, Traceroute, DHCP; Schichtenansicht | ✅ |
| M5 | DNS, TCP/UDP, HTTP | ✅ |
| M6 | E-Mail, Aufgabenformat mit automatischer Prüfung | ✅ |
| M7 | Deployment (Variante A und B) | ✅ |
| + | Kabel umstecken/beschädigen, DHCP-Relay, Internet mit NAT, VLANs und Spanning Tree, schnelle Paketliste | ✅ |
| + | Aufgaben-Formular, Abgaben auswerten, Oberflächentests, CI | ✅ |
| + | Basis-/Pro-Modus, Router-on-a-Stick, Layer-3-Switch, Befehlszeile (FRRouting-Stil), SSH | ✅ |
| + | WLAN mit Access Point, Mesh über Stockwerke, TP/Glasfaser/Funk, Link-LEDs, Farbtags | ✅ |
| + | Dokumentationsmodus mit Bereichen, Stockwerke, Snapshots, Rack-Ansicht | ✅ |
| + | Desktop-Installer (Tauri), Plesk-Testumgebung, Lizenzhinweise im Build | ✅ |
| + | SFP-Module für Glasfaser, Racks auf der Karte, Bereiche kopieren, hell/dunkel, Englisch statt Französisch | ✅ |
| + | Webversion mit Node.js: Sessions mit Code, Klassen-Sessions, Rückmeldungen, Admin-Konsole (erlaubte Modi, Pro, Aufbewahrung) | ✅ |
| + | Aufgabenkatalog mit Schwierigkeit 1–5 Sterne | ✅ |

## Entwicklung

Voraussetzung: Node.js 20 oder neuer.

**Branches:** `develop` ist der Entwicklungsstand (Testversion auf Plesk, siehe [docs/plesk.md](docs/plesk.md)), `main` die stabile Version. Gearbeitet wird auf `develop`; vor dem Arbeiten `git pull`, vor dem Push `npm run release`.

```bash
npm ci
npm run dev      # Entwicklungsserver auf http://localhost:5173
npm test         # Tests des Simulationskerns
npm run test:server    # Tests des Node.js-Servers (Webversion)
npm run server   # Webversion lokal auf http://localhost:3000 (ADMIN_PASSWORD setzen für die Admin-Konsole)
npm run check    # Typprüfung (UI und DOM-freier Kern)
npm run build    # erzeugt dist/index.html
npm run verify   # alles zusammen: Typprüfung, Tests, Server-Tests, Build (vor jedem Commit)
npm run release  # verify + release/netzwerk-simulator.html neu erzeugen und offline prüfen
npm run e2e      # Oberflächentests (Playwright) gegen den Build
npm run desktop:dev    # Desktop-Fenster (Tauri, braucht Rust)
npm run desktop:build  # Installer für das eigene System
```

Die Oberflächentests laden keine eigenen Browser herunter, sondern nutzen den installierten: unter Windows Edge, sonst Chrome (anderer Kanal mit `PW_CHANNEL`, z.B. `PW_CHANNEL=chromium` nach `npx playwright install chromium`, oder ein beliebiges Chromium mit `PW_EXECUTABLE=/pfad/zu/chromium`).

`npm run build` erzeugt **eine einzige Datei** `dist/index.html`, die alle Skripte und Stile enthält. `npm run release` kopiert sie nach `release/netzwerk-simulator.html` (diese Datei ist eingecheckt, damit sie ohne Node.js nutzbar ist) und bricht ab, falls sie externe Ressourcen enthält, die CSP fehlt oder Lizenzhinweise fehlen. **Nach Änderungen am Code vor dem Push `npm run release` ausführen**, sonst bleibt die verteilte Datei auf dem alten Stand.

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) führt bei jedem Push `npm run release` (inklusive Server-Tests) und die Oberflächentests aus und schlägt fehl, wenn die eingecheckte `release/netzwerk-simulator.html` nicht zum Code passt.

Schulserver: `docker compose up -d --build` (siehe [docs/installation.md](docs/installation.md#b-schulserver-mit-docker)).

## Aufbau

```
src/
  core/   Simulationskern und Dateiformat: reines TypeScript, ohne DOM
  ui/     Svelte-Oberfläche (Editor, Palette, Inspektor)
  i18n/   Sprachdateien (de.json, en.json; ein Test prüft gleiche Schlüssel)
server/   Node.js-Server der Webversion (ohne Abhängigkeiten): Sessions, Klassen, Rückmeldungen, Admin
docs/     Konzept, Installation, Plesk, Desktop, Befehlszeile, Datenschutz
```

Regeln, die das Projekt technisch absichert:

- **Der Kern kennt keine Oberfläche.** `tsconfig.core.json` prüft `src/core` ohne DOM-Typen; ein Zugriff auf `document` oder `window` schlägt bei `npm run check` fehl. So bleibt der Kern ohne Browser testbar.
- **Unveränderliche Topologie.** Jede Operation in `core/model/topology.ts` liefert eine neue Topologie oder einen Fehlercode. Undo/Redo speichert daher einfach frühere Stände.
- **Fehlermeldungen kommen aus den Sprachdateien.** Der Kern liefert nur Code und Parameter (z.B. `noFreeInterface`), die Oberfläche übersetzt.
- **Deterministische MAC-Adressen** aus der Gerätenummer (`02:00:…`, lokal administriert).

## Simulation

`core/sim/simulation.ts` ist eine diskrete Ereignis-Simulation: Jede Kabelübertragung und jeder Timer ist ein Ereignis mit virtuellem Zeitstempel in einer Prioritätswarteschlange (`core/sim/queue.ts`). Ereignisse zur gleichen Zeit laufen in Einfügereihenfolge, darum ergibt derselbe Ablauf immer dieselbe Paketfolge, und Tests können sie exakt prüfen.

- Schnittstelle für die Oberfläche: `step()`, `runUntil(t)`, `getPacketLog()`, `getDeviceState(id)`, `ping(id, ziel)`.
- Pakete sind verschachtelte Objekte (`core/sim/frames.ts`): Ethernet-Rahmen → ARP oder IPv4 → ICMP.
- Jedes Kabel braucht 1 ms. Im Aktionsmodus läuft die virtuelle Zeit synchron zur echten; im Entwurfsmodus pausiert sie, Zustände wie ARP-Tabellen bleiben erhalten.
- Wird ein Kabel während einer Übertragung entfernt, geht der Rahmen verloren und ist in der Paketliste so markiert.
- Switches lernen MAC-Adressen pro Port (5 Minuten gültig). Vermittlungsrechner leiten nach längstem Präfix weiter, senken die TTL und melden Probleme per ICMP («Ziel nicht erreichbar», «TTL abgelaufen»). Das Modem ist eine transparente Strecke.
- Endgeräte haben einen Desktop (Doppelklick im Aktionsmodus) mit Befehlszeile: `ping`, `tracert`, `ipconfig [/release|/renew]`, `arp [-a|-d]`, `cls`, `help`.
- DHCP: Rechner können DHCP-Server sein; Clients beziehen beim Start der Simulation per Discover/Offer/Request/Ack eine Adresse und erneuern nach der halben Lease-Dauer.
- DNS: Rechner können DNS-Server mit eigener Zone sein (A- und MX-Einträge, ohne Rekursion). Clients haben einen Cache gemäss TTL; `nslookup`, `ipconfig /displaydns` und `/flushdns` machen ihn sichtbar. `ping` und `tracert` akzeptieren Namen.
- TCP: Drei-Wege-Handshake, Sequenz- und Bestätigungsnummern (in Zeichen), Aufteilung in Segmente, Wiederholung nach 1 s (höchstens 3-mal), Abbau mit FIN, RST bei geschlossenem Port; `netstat` zeigt Verbindungen.
- HTTP: Rechner können Webserver mit editierbaren HTML-Seiten sein. Der Webbrowser zeigt jeden Schritt (DNS, TCP, GET, Antwort) und die Seite; Links darin lösen simulierte Abrufe aus. Seiten laufen in einem Sandbox-Frame ohne Skripte.
- E-Mail: Rechner können Mailserver sein (Domain, Postfächer). SMTP zum Versenden, auch zwischen Domains über MX-Einträge; POP3 (abholen und löschen) und IMAP (Nachrichten bleiben auf dem Server). Das E-Mail-Programm zeigt den ganzen Protokolldialog.
- Paketliste mit Schichtenansicht (Ethernet → ARP/IPv4 → ICMP/UDP/TCP → DHCP/DNS/HTTP/SMTP/POP3/IMAP); Vereinfachungen sind pro Schicht vermerkt. Zeitlauf-Regler mit Anhalten, Einzelschritt und Zeitlupe, in der die Rahmen als Punkte über die Kabel wandern.
- Kabel lassen sich auf andere Anschlüsse umstecken und können beschädigt sein (0–100 % Paketverlust, für Fehlersuche-Übungen; ein Zufallsgenerator mit festem Startwert hält Abläufe wiederholbar).
- Router können als DHCP-Relay einen zentralen DHCP-Server für mehrere Netze nutzen; der Server hat dafür weitere Bereiche.
- Das Gerät «Internet» leitet wie ein Provider weiter und verwirft private Adressen. Router übersetzen mit NAT (inkl. Port-Übersetzung) und bieten Portweiterleitungen für Server im Heimnetz.
- VLANs: Switch-Ports gehören zu einem VLAN (Access) oder übertragen als Trunk alle VLANs mit 802.1Q-Tag; die MAC-Tabelle gilt je VLAN.
- Spanning Tree (vereinfacht, verkürzte Zeiten): Switches wählen per BPDU eine Root-Bridge und blockieren redundante Ports; nach einem Ausfall wird neu berechnet. Schleifen zwischen Switches erlaubt der Editor nur, wenn alle beteiligten Switches STP aktiv haben; Ports zu Endgeräten leiten sofort weiter (wie PortFast).
- **Basis/Pro**: Der Schalter oben rechts blendet fortgeschrittene Funktionen ein (VLANs, Trunks, Spanning Tree, NAT, DHCP-Relay, Router-on-a-Stick, Layer-3-Switch). Projekte, die solche Funktionen nutzen, schalten beim Öffnen automatisch auf Pro.
- **Router-on-a-Stick**: Router-Subinterfaces mit 802.1Q-Tag (`eth0.10`) an einem Trunk-Port; jedes ist Gateway eines VLANs.
- **Layer-3-Switch**: Switch mit VLAN-Interfaces (SVIs) als Gateways, routet zwischen VLANs (`ip routing`), auch mit DHCP-Relay.
- **Befehlszeile** für Router und Switches im Stil von FRRouting (vtysh), mit Abkürzungen, `?`, Tab und `do`; Zugang per Doppelklick (Konsole) oder per `ssh` vom PC über simuliertes TCP. Befehlsreferenz: [docs/cli.md](docs/cli.md).
- **Verbindungsarten**: TP-Kabel, Glasfaser und Funk (WLAN). Jedes Kabelende zeigt eine Link-LED (grün aktiv, rot aus mit Grund), Anschlüsse haben Farbtags und Beschreibungen, Ports lassen sich abschalten (`shutdown`).
- **WLAN**: Access Points mit SSID, WPA2-Passwort, Band und Kanal; Endgeräte mit WLAN-Profil. Die Signalqualität hängt von Abstand und Stockwerken ab. **Mesh**: Access Points mit Mesh-Betrieb verbinden sich per Funk, auch über Stockwerke.
- **Stockwerke**: Geräte und Bereiche liegen auf Stockwerken; die Ansicht zeigt alle oder eines.
- **Dokumentationsmodus**: farbige Bereiche mit Titel, Netz (Netzadresse, Maske, Hostbereich und Broadcast werden berechnet), VLAN und Notiz.
- **Snapshots**: benannte Zwischenstände, automatisch vor jedem Start der Simulation; sie werden mit dem Projekt gespeichert.
- **Frontansicht und Rack**: Switch-Ports wie auf dem Gerät, Umstecken per Klick; die Rack-Ansicht zeigt alle Netzwerkgeräte pro Stockwerk.
- Konfigurationen werden nur auf Lesbarkeit geprüft. Fachliche Fehler (Gateway ausserhalb des Netzes, Netzadresse als Geräteadresse) sind erlaubt und werden als Warnung erklärt, damit Lehrpersonen Fehlersuche-Aufgaben bauen können.

## Aufgaben

Aufgabendateien enthalten zusätzlich Lernziele, die der Simulator auf Knopfdruck prüft (z.B. «PC 1 erreicht PC 2 per Ping»). Lehrpersonen erstellen sie direkt im Simulator in einem Formular (oder als JSON) und werten mit «Abgaben auswerten …» die Dateien einer ganzen Klasse auf einmal aus, mit Export als CSV für Excel. Beschreibung aller Prüfbausteine: [docs/aufgaben.md](docs/aufgaben.md). Musteraufgabe: [docs/aufgaben/zwei-subnetze.json](docs/aufgaben/zwei-subnetze.json).

## Beispiele

[docs/beispiele](docs/beispiele) enthält fertige Projekte zum Öffnen (`Öffnen …`), z.B. `zwei-subnetze.json` (PC 1 erreicht über Router 1 einen Switch mit zwei Geräten im zweiten Subnetz) `dhcp.json` (ein Server vergibt drei Clients ihre Adressen) `web.json` (ein Notebook bezieht per DHCP Adresse und DNS-Server und ruft über einen Router `http://www.schule.ch/` ab) `mail.json` (Anna und Ben schreiben sich E-Mails über einen gemeinsamen Mailserver) `heimnetz-nat.json` (Heimnetz mit NAT, öffentlicher Webserver, Portweiterleitung auf ein NAS) `vlan-stp.json` (drei Switches im Ring mit Spanning Tree, zwei VLANs über Trunks), `router-on-a-stick.json` (zwei VLANs, ein Router mit Subinterfaces, SSH-Zugang `admin` / `Netz2026`), `layer3-switch.json` (Core-Switch routet zwischen drei VLANs, zentraler DHCP-Server über Relay, dokumentierte Bereiche) und `wlan-mesh.json` (zwei Mesh-Access-Points im EG und OG). Ein Test stellt sicher, dass alle Beispiele gültig bleiben.

## Datenschutz

Ausgelegt auf revDSG und DSGVO, Details und eine Textvorlage für Schulen in [docs/datenschutz.md](docs/datenschutz.md):

- Keine Konten, keine Namen, keine E-Mail-Adressen, kein Tracking, keine Cookies, keine externen Schriften oder CDNs.
- Lokale Datei und Desktop-Version: Content-Security-Policy mit `connect-src 'none'`, die Seite kann technisch keine Netzwerkverbindung aufbauen. Projekte liegen in IndexedDB im Browserprofil und lassen sich als `.json` exportieren.
- Webversion: Sessions enthalten nur die Netzwerk-Konfiguration unter einem Zufallscode und werden automatisch gelöscht (Standard 24 Stunden, einstellbar). Klassen tragen nur eine Bezeichnung wie «INF22a». IP-Adressen werden nicht gespeichert.

## Projektdatei

Klartext-JSON mit `meta` (Format und Version), `topology` (Geräte, Anschlüsse mit MAC, IP und Maske, Kabel mit Medium, Dokumentationsbereiche, Stockwerke), `configuration` (geräteübergreifende Einstellungen, derzeit leer) und optional `snapshots` (Zwischenstände). Gerätebezogene Einstellungen wie Gateway und DNS-Server liegen direkt beim Gerät. Beim Öffnen wird die Datei vollständig geprüft; unbekannte Felder werden verworfen, und Fehler nennen die betroffene Stelle (z.B. `topology.devices[2].type`).

## Herkunft

Die Idee orientiert sich am öffentlich dokumentierten Konzept der Lernsoftware FILIUS (Universität Siegen). Dies ist eine eigenständige Neuimplementation: Code, Grafiken und Texte des Originals werden nicht verwendet.

## Lizenz

[MIT](LICENSE) © 2026 Mikael von Allmen & vonam-git. Freie Nutzung, Anpassung und Weitergabe, auch an andere Schulen, solange der Lizenzhinweis erhalten bleibt.

Eingebaute Software anderer (z.B. die Svelte-Laufzeit) steht unter MIT-kompatiblen Lizenzen; die Hinweise liegen in [release/THIRD_PARTY_NOTICES.md](release/THIRD_PARTY_NOTICES.md) und erscheinen im Simulator unter **Über**. Der Build prüft die Lizenzen und bricht bei einer nicht freigegebenen ab. Die Desktop-Version liefert zusätzlich die Lizenzen der Rust-Pakete mit ([docs/desktop.md](docs/desktop.md)). Die Befehlszeile bildet die Syntax von FRRouting nur nach und enthält keinen Code daraus ([docs/cli.md](docs/cli.md#lizenzen)).
