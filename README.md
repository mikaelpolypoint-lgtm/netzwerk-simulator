# Netzwerk-Simulator

Webbasierter Simulator für Rechnernetze im Informatik-Unterricht (Informatik EFZ). Lernende bauen Topologien auf, konfigurieren Geräte und beobachten den Verkehr auf Paketebene. Läuft vollständig im Browser, offline, ohne Konten und ohne externe Dienste.

Die vollständige Anforderungsbeschreibung steht in [docs/konzept.md](docs/konzept.md).

## Stand

| Etappe | Inhalt | Status |
|---|---|---|
| M1 | Topologie-Editor, Speichern/Laden als .json | ✅ |
| M2 | Simulationskern, ARP, IPv4 im gleichen Subnetz, Paketliste | ✅ |
| M3 | Switch-Lerntabelle, Subnetting, Router mit statischen Routen | ✅ |
| M4 | Aktionsmodus mit Desktop: Ping, Traceroute, DHCP; Schichtenansicht | ✅ |
| M5 | DNS, TCP/UDP, HTTP | ✅ |
| M6 | E-Mail, Aufgabenformat mit automatischer Prüfung | offen |
| M7 | Deployment (Variante A und B) | offen |

## Entwicklung

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run dev      # Entwicklungsserver auf http://localhost:5173
npm test         # Tests des Simulationskerns
npm run check    # Typprüfung (UI und DOM-freier Kern)
npm run build    # erzeugt dist/index.html
npm run verify   # alles zusammen: Typprüfung, Tests, Build (vor jedem Commit)
```

`npm run build` erzeugt **eine einzige Datei** `dist/index.html`, die alle Skripte und Stile enthält. Sie lässt sich direkt per Doppelklick vom Datenträger öffnen (Variante A) oder von einem beliebigen statischen Webserver ausliefern (Variante B).

## Aufbau

```
src/
  core/   Simulationskern und Dateiformat: reines TypeScript, ohne DOM
  ui/     Svelte-Oberfläche (Editor, Palette, Inspektor)
  i18n/   Sprachdateien (de.json; weitere Sprachen mit denselben Schlüsseln)
docs/     Konzept-Spezifikation
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
- DHCP: Rechner können DHCP-Server sein; Clients beziehen beim Start der Simulation per Discover/Offer/Request/Ack eine Adresse und erneuern nach der halben Lease-Dauer. Router leiten DHCP nicht weiter (kein Relay), der Server muss im selben Netz stehen.
- DNS: Rechner können DNS-Server mit eigener Zone sein (A- und MX-Einträge, ohne Rekursion). Clients haben einen Cache gemäss TTL; `nslookup`, `ipconfig /displaydns` und `/flushdns` machen ihn sichtbar. `ping` und `tracert` akzeptieren Namen.
- TCP: Drei-Wege-Handshake, Sequenz- und Bestätigungsnummern (in Zeichen), Aufteilung in Segmente, Wiederholung nach 1 s (höchstens 3-mal), Abbau mit FIN, RST bei geschlossenem Port; `netstat` zeigt Verbindungen.
- HTTP: Rechner können Webserver mit editierbaren HTML-Seiten sein. Der Webbrowser zeigt jeden Schritt (DNS, TCP, GET, Antwort) und die Seite; Links darin lösen simulierte Abrufe aus. Seiten laufen in einem Sandbox-Frame ohne Skripte.
- Paketliste mit Schichtenansicht (Ethernet → ARP/IPv4 → ICMP/UDP/TCP → DHCP/DNS/HTTP); Vereinfachungen sind pro Schicht vermerkt. Zeitlauf-Regler mit Anhalten, Einzelschritt und Zeitlupe, in der die Rahmen als Punkte über die Kabel wandern.
- Schleifen zwischen Switches lässt der Editor nicht zu (es gibt kein Spanning Tree, sonst entstünde ein Broadcast-Sturm).
- Konfigurationen werden nur auf Lesbarkeit geprüft. Fachliche Fehler (Gateway ausserhalb des Netzes, Netzadresse als Geräteadresse) sind erlaubt und werden als Warnung erklärt, damit Lehrpersonen Fehlersuche-Aufgaben bauen können.

## Beispiele

[docs/beispiele](docs/beispiele) enthält fertige Projekte zum Öffnen (`Öffnen …`), z.B. `zwei-subnetze.json` (PC 1 erreicht über Router 1 einen Switch mit zwei Geräten im zweiten Subnetz) `dhcp.json` (ein Server vergibt drei Clients ihre Adressen) und `web.json` (ein Notebook bezieht per DHCP Adresse und DNS-Server und ruft über einen Router `http://www.schule.ch/` ab). Ein Test stellt sicher, dass alle Beispiele gültig bleiben.

## Datenschutz

- Keine Konten, kein Tracking, keine Cookies, keine externen Schriften oder CDNs.
- Der Build setzt eine Content-Security-Policy mit `connect-src 'none'`: Die Seite kann technisch keine Netzwerkverbindung aufbauen.
- Projekte werden automatisch in IndexedDB im Browserprofil zwischengespeichert und lassen sich als `.json` exportieren. Der Simulator selbst verarbeitet keine Personendaten.

## Projektdatei

Klartext-JSON mit `meta` (Format und Version), `topology` (Geräte, Anschlüsse mit MAC, IP und Maske, Kabel) und `configuration` (geräteübergreifende Einstellungen, derzeit leer). Gerätebezogene Einstellungen wie Gateway und DNS-Server liegen direkt beim Gerät. Beim Öffnen wird die Datei vollständig geprüft; unbekannte Felder werden verworfen, und Fehler nennen die betroffene Stelle (z.B. `topology.devices[2].type`).

## Herkunft

Die Idee orientiert sich am öffentlich dokumentierten Konzept der Lernsoftware FILIUS (Universität Siegen). Dies ist eine eigenständige Neuimplementation: Code, Grafiken und Texte des Originals werden nicht verwendet.
