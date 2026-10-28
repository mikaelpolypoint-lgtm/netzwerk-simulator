# Netzwerk-Simulator

Webbasierter Simulator für Rechnernetze im Informatik-Unterricht (Informatik EFZ). Lernende bauen Topologien auf, konfigurieren Geräte und beobachten den Verkehr auf Paketebene. Läuft vollständig im Browser, offline, ohne Konten und ohne externe Dienste.

Die vollständige Anforderungsbeschreibung steht in [docs/konzept.md](docs/konzept.md).

## Stand

| Etappe | Inhalt | Status |
|---|---|---|
| M1 | Topologie-Editor, Speichern/Laden als .json | ✅ |
| M2 | Simulationskern, ARP, IPv4 im gleichen Subnetz, Paketliste | offen |
| M3 | Switch-Lerntabelle, Subnetting, Router mit statischen Routen | offen |
| M4 | Aktionsmodus mit Desktop: Ping, Traceroute, DHCP; Schichtenansicht | offen |
| M5 | DNS, TCP/UDP, HTTP | offen |
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

## Datenschutz

- Keine Konten, kein Tracking, keine Cookies, keine externen Schriften oder CDNs.
- Der Build setzt eine Content-Security-Policy mit `connect-src 'none'`: Die Seite kann technisch keine Netzwerkverbindung aufbauen.
- Projekte werden automatisch in IndexedDB im Browserprofil zwischengespeichert und lassen sich als `.json` exportieren. Der Simulator selbst verarbeitet keine Personendaten.

## Projektdatei

Klartext-JSON mit `meta` (Format und Version), `topology` (Geräte, Anschlüsse mit MAC, Kabel) und `configuration` (folgt ab M2). Beim Öffnen wird die Datei vollständig geprüft; unbekannte Felder werden verworfen, und Fehler nennen die betroffene Stelle (z.B. `topology.devices[2].type`).

## Herkunft

Die Idee orientiert sich am öffentlich dokumentierten Konzept der Lernsoftware FILIUS (Universität Siegen). Dies ist eine eigenständige Neuimplementation: Code, Grafiken und Texte des Originals werden nicht verwendet.
