# Installation

Der Netzwerk-Simulator ist **eine einzige HTML-Datei**. Sie braucht kein Internet, keinen Server und keine Installation von Programmen – ein aktueller Browser genügt (Chrome, Edge, Firefox oder Safari).

Es gibt drei Wege, je nachdem, was du vorhast:

| Weg | Für wen | Braucht |
|---|---|---|
| [A: Datei direkt öffnen](#a-datei-direkt-öffnen) | Unterricht, Prüfungsrechner, Lernende zu Hause | nur einen Browser (Git optional) |
| [B: Schulserver](#b-schulserver-mit-docker) | ganze Schule im Schulnetz | Docker |
| [C: Selbst bauen](#c-selbst-bauen-und-anpassen) | Anpassungen am Simulator | Git und Node.js |
| [Webhosting mit Plesk](plesk.md) | Testversion oder öffentliche Version im Web | Plesk mit Git-Erweiterung |
| [Desktop-Version](desktop.md) | Installation als Programm (Windows, macOS, Linux) | Installer aus den GitHub-Releases |

---

## A: Datei direkt öffnen

### Mit Git

```bash
git clone https://github.com/vonam-git/netzwerk-simulator.git
```

Danach im Ordner `netzwerk-simulator/release/` die Datei **`netzwerk-simulator.html`** doppelklicken. Fertig.

Neue Versionen holen:

```bash
cd netzwerk-simulator
git pull
```

### Ohne Git

1. Auf GitHub das Repository öffnen: <https://github.com/vonam-git/netzwerk-simulator>
2. In den Ordner `release` wechseln und `netzwerk-simulator.html` anklicken.
3. Oben rechts **«Download raw file»** wählen und die Datei speichern.

### An die Klasse verteilen

- Die Datei auf den Schul-Share, einen USB-Stick oder ins Lernportal legen. Jede Person öffnet sie mit Doppelklick.
- Sie funktioniert auch auf isolierten Prüfungsrechnern ohne Netzwerk.
- Beispielnetze und Aufgaben (Ordner `docs/beispiele` und `docs/aufgaben`) können ebenfalls verteilt und im Simulator mit **Öffnen …** geladen werden.

### Wichtig zum Speichern

Der Simulator merkt sich den letzten Stand automatisch im Browser. Wird die Datei direkt vom Datenträger geöffnet (`file://`), ist das **je nach Browser eingeschränkt**. Darum Arbeiten immer zusätzlich mit **Speichern** (Strg+S) als `.json`-Datei sichern.

---

## B: Schulserver mit Docker

Für den Betrieb im Schulnetz liefert ein kleiner Nginx-Container die Datei aus. Es gibt keine Datenbank, keine Konten und keine Zugriffsprotokolle.

```bash
git clone https://github.com/vonam-git/netzwerk-simulator.git
cd netzwerk-simulator
docker compose up -d --build
```

Danach ist der Simulator unter `http://<servername>:8080` erreichbar. Update:

```bash
git pull
docker compose up -d --build
```

Der Container baut nichts selbst, sondern übernimmt die fertige Datei aus `release/`. Ist das Basis-Image `nginx:1.27-alpine` einmal heruntergeladen, funktioniert das auch ohne Internet.

### Mit HTTPS (optional)

Hinter einem Reverse Proxy mit TLS, z.B. [Caddy](https://caddyserver.com/), mit der Datei `Caddyfile`:

```
simulator.schule.example {
    reverse_proxy localhost:8080
    log {
        output discard
    }
}
```

### Ohne Docker

Jeder Webserver kann die Datei ausliefern: `release/netzwerk-simulator.html` als `index.html` in das Webverzeichnis kopieren. Zugriffsprotokolle möglichst abschalten (Nginx: `access_log off;`) oder IP-Adressen anonymisieren.

---

## C: Selbst bauen und anpassen

Voraussetzung: [Node.js](https://nodejs.org/) ab Version 20 (LTS empfohlen) und Git.

```bash
git clone https://github.com/vonam-git/netzwerk-simulator.git
cd netzwerk-simulator
npm ci
npm run dev
```

`npm run dev` startet den Simulator unter <http://localhost:5173> und lädt Änderungen sofort neu.

| Befehl | Zweck |
|---|---|
| `npm test` | Tests des Simulationskerns |
| `npm run verify` | Typprüfung, Tests und Build (vor jedem Commit) |
| `npm run release` | baut `release/netzwerk-simulator.html` neu und prüft, dass sie ohne Internet funktioniert |

Texte der Oberfläche stehen in `src/i18n/de.json`. Englisch steht in `en.json`; eine weitere Übersetzung entsteht als neue Datei mit denselben Schlüsseln (und einem Eintrag in `src/i18n/locale.svelte.ts`).

---

## Datenschutz (für die Schule)

Textvorschlag für das Verzeichnis der Bearbeitungstätigkeiten oder die Beschreibung des Angebots:

> Der Netzwerk-Simulator ist eine Lernsoftware, die vollständig im Browser der nutzenden Person läuft. Er verarbeitet keine Personendaten: Es gibt keine Benutzerkonten, keine Anmeldung, keine Cookies, kein Tracking und keine Verbindungen zu Drittanbietern. Projekte werden ausschliesslich lokal im Browser (IndexedDB) oder als Datei gespeichert, die die nutzende Person selbst verwaltet. Beim Betrieb auf einem Schulserver liefert dieser nur eine unveränderliche Datei aus; Zugriffsprotokolle sind abgeschaltet.

Hinweis: Passwörter von Postfächern im Simulator sind nur simuliert und stehen im Klartext in der Projektdatei. Lernende sollen dort keine echten Passwörter verwenden.

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| Leere Seite | Browser aktualisieren; ältere Browser (z.B. Internet Explorer) werden nicht unterstützt. |
| Nach dem Schliessen ist die Arbeit weg | Beim Öffnen per Doppelklick speichert nicht jeder Browser automatisch. Mit **Speichern** sichern, mit **Öffnen …** laden. |
| «Die Datei stammt aus einer neueren Version» | Simulator aktualisieren (`git pull` bzw. neue Datei herunterladen). |
| Pakete wandern nicht sichtbar | Tempo auf **Zeitlupe** stellen; in Echtzeit dauert eine Übertragung nur 1 ms. |
