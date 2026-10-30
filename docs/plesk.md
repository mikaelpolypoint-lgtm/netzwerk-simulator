# Webversion auf Plesk (Node.js)

Der Branch `develop` ist der Entwicklungsstand. Plesk holt ihn von GitHub und startet den kleinen Node.js-Server aus `server/`. Er liefert die fertige Datei `release/netzwerk-simulator.html` aus und bietet zusätzlich Sessions mit Code, Klassen-Sessions, Rückmeldungen und die Admin-Konsole. Auf dem Server wird nichts gebaut, und es werden keine npm-Pakete installiert: Der Server nutzt nur Node.js-Bordmittel.

```
Rechner (du)  ──git push──►  GitHub: develop  ──Plesk Git (Pull)──►  simulator-test.deine-domain.ch
                                                                      └─ Node.js: server/start.cjs (Anwendungsstamm httpdocs/server)
```

## Einmalig einrichten

1. **Subdomain anlegen**, z.B. `simulator-test.deine-domain.ch` (Websites & Domains → Subdomain hinzufügen).
2. **Git hinzufügen**: bei der Subdomain auf **Git** klicken.
   - Repository: **Remote-Git-Hosting**
   - URL: `https://github.com/vonam-git/netzwerk-simulator.git`
     (bei einem privaten Repository die SSH-URL `git@github.com:vonam-git/netzwerk-simulator.git` und den von Plesk angezeigten SSH-Schlüssel auf GitHub unter *Settings → Deploy keys* eintragen, nur Lesezugriff)
   - Bereitstellungsmodus: **Automatisch**
   - Serverpfad: `/httpdocs`
   - Nach dem Anlegen in den Git-Einstellungen den **Branch auf `develop`** stellen.
   - Unter **Zusätzliche Bereitstellungsaktionen** eintragen, damit der Server nach jedem Pull neu startet:
     ```
     mkdir -p tmp && touch tmp/restart.txt
     ```
3. **Node.js aktivieren** (bei der Subdomain auf **Node.js**):
   - Node.js-Version: **18 oder neuer** (empfohlen: die neueste LTS)
   - Anwendungsmodus: `production`
   - Anwendungsstamm: **`/httpdocs/server`** (dort liegt eine eigene `package.json` ohne Abhängigkeiten; im Hauptordner würde Plesk ab Version 18.0.81 wegen Vite eine «statische» App erkennen und den Node-Server nicht starten)
   - Dokumentstamm: `/httpdocs/server/public` (absichtlich leer, so ist der Quellcode nicht direkt erreichbar)
   - Anwendungsstartdatei: `start.cjs`
   - Zeigt das Dashboard danach als Anwendungstyp «Statisch (Vite)», Node.js einmal deaktivieren und mit diesen Werten wieder aktivieren, damit Plesk neu erkennt.
   - **Benutzerdefinierte Umgebungsvariablen**:
     | Name | Wert | Zweck |
     |---|---|---|
     | `ADMIN_PASSWORD` | ein langes, zufälliges Passwort | öffnet die Admin-Konsole; ohne diese Variable ist sie gesperrt |
     | `DATA_DIR` | optional, z.B. `/var/www/vhosts/deine-domain.ch/simulator-data` | Ablage der Sessions; Standard ist `httpdocs/data` (ausserhalb des Dokumentstamms) |
   - *NPM install* ist nicht nötig. Auf **Node.js aktivieren** bzw. **App neu starten** klicken.
4. **SSL/TLS** für die Subdomain aktivieren (Let's Encrypt in Plesk) und *Permanente SEO-sichere 301-Weiterleitung von HTTP zu HTTPS* einschalten.
5. **Zugriffsprotokolle** (Datenschutz): Plesk speichert standardmässig IP-Adressen im Access-Log des Webservers. Unter *Protokolle → Protokollrotation* die Aufbewahrung auf wenige Tage begrenzen oder die Protokollierung für die Subdomain abschalten (siehe [datenschutz.md](datenschutz.md#webserver-protokolle)).

Danach unter der Adresse der Subdomain den Simulator öffnen. Oben rechts erscheint der Session-Code, unter **Werkzeuge → Admin-Konsole** die Anmeldung.

## Admin-Konsole

- **Klassen**: Klassen-Sessions eröffnen (nur eine Bezeichnung wie «INF22a», keine Namen), den Klassencode verteilen, die Arbeiten der Klasse öffnen und die Klasse schliessen.
- **Rückmeldungen**: Probleme und Ideen der Lernenden, mit Status *neu / in Arbeit / erledigt*.
- **Einstellungen**:
  - erlaubte Modi (Entwurf, Simulation)
  - **Standardprofil** und **höchstes Profil** (1 = 1. Lehrjahr … 5 = Studium) sowie einzelne **gesperrte Funktionen** (siehe [funktionsprofile.md](funktionsprofile.md))
  - Aufbewahrung von Sessions, Klassen und Rückmeldungen, Rückmeldungen ein/aus
- **Prüfungen**: Ergebnis der Release-Prüfung (Datenschutz, Sicherheit, Lizenzen) der ausgelieferten Version aus `release/checks.json` (siehe [datenschutz.md](datenschutz.md#prüfung-bei-jedem-release)).

Ältere Einstellungen (Aktions- und Dokumentationsmodus, Pro-Version) werden beim ersten Start automatisch übernommen: «Pro aus» wird zu höchstem Profil 3.

In der lokalen HTML-Datei und in der Desktop-Version gibt es keinen Server; dort ist die Admin-Konsole ausgegraut und alles erlaubt. Lehrpersonen steuern den Funktionsumfang dort mit einer Funktionsdatei.

## Automatisch aktualisieren nach jedem Push

In Plesk unter *Git → Repository-Einstellungen* steht eine **Webhook-URL**. Diese auf GitHub eintragen:

*Repository → Settings → Webhooks → Add webhook*
- Payload URL: die Webhook-URL aus Plesk
- Content type: `application/json`
- Events: *Just the push event*

Ohne Webhook in Plesk einfach auf **Pull Updates** klicken (und, falls keine Bereitstellungsaktion eingetragen ist, auf **App neu starten**).

## Fehlersuche

- **Dashboard zeigt «Anwendungstyp: Statisch (Vite)», Status inaktiv:** Plesk hat die `package.json` im Hauptordner gelesen und hält das Projekt für eine statische Vite-Seite. Anwendungsstamm auf `/httpdocs/server` und Startdatei auf `start.cjs` stellen (siehe oben), Node.js deaktivieren und wieder aktivieren.

- **Konsole meldet `…/src/main.ts` mit falschem MIME-Typ:** Der Webserver liefert die Quelldatei `index.html` aus dem Repository-Ordner aus statt der Node-App. Der **Dokumentstamm** steht falsch (meist auf `/httpdocs`). Unter *Node.js* den Dokumentstamm auf `/httpdocs/server/public` setzen und *App neu starten*. Wichtig auch für den Datenschutz: Mit `/httpdocs` als Dokumentstamm wären Quellcode und Datenordner direkt abrufbar. Der Server legt im Datenordner deshalb zusätzlich eine `.htaccess` an, die jeden Zugriff verbietet.

- **Weisse Seite oder «Wird geladen …» bleibt stehen:** Das Programm startet im Browser nicht. Browser-Konsole öffnen (F12). Steht dort «Refused to execute … Content-Security-Policy», setzt das Hosting eine eigene, strengere Richtlinie. Der Node-Server liefert Skripte und Stile deshalb als eigene Dateien unter `/assets/…` aus (keine Inline-Skripte), damit die Seite auch dann läuft. Eine zusätzliche Richtlinie unter *Apache & nginx-Einstellungen* sollte trotzdem entfernt werden.
- **`/healthz` antwortet nicht mit `ok`:** Die Node.js-App läuft nicht. Unter *Node.js* Anwendungsstamm `/httpdocs/server`, Startdatei `start.cjs` und Dokumentstamm `/httpdocs/server/public` prüfen, dann *App neu starten*; Fehler stehen unter *Protokolle anzeigen*.
- **Alter Stand:** *Git → Pull Updates*, danach *App neu starten*.

## Ablauf im Alltag

```bash
git switch develop
git pull                 # Stand von GitHub holen
# … ändern …
npm run release          # Tests, Build, release/netzwerk-simulator.html neu erzeugen
npm run test:server      # Server-Tests
git add -A
git commit -m "Was geändert wurde"
git push                 # Plesk zieht den neuen Stand
```

Wichtig: Der Server liefert die **eingecheckte** Datei `release/netzwerk-simulator.html` aus. Ohne `npm run release` vor dem Commit bleibt die Webversion auf dem alten Stand. Die CI auf GitHub meldet das mit einem roten Kreuz.

Lokal lässt sich die Webversion so ausprobieren:

```bash
ADMIN_PASSWORD=test npm run server     # http://localhost:3000
```

## Stabile Version

Ist der Stand auf `develop` gut, wird er nach `main` übernommen (Pull Request auf GitHub oder lokal `git switch main && git merge develop && git push`). Eine zweite Subdomain kann auf gleiche Weise den Branch `main` ausliefern; jede Subdomain hat ihre eigenen Sessions und ihr eigenes Admin-Passwort.

## Ohne Node.js (nur statisch)

Bietet das Hosting kein Node.js, kann die Datei auch rein statisch ausgeliefert werden: Dokumentstamm auf `httpdocs/release` setzen; `release/.htaccess` öffnet den Simulator ohne Dateinamen und setzt die Sicherheits-Header. Sessions, Klassen, Rückmeldungen und Admin-Konsole gibt es dann nicht; die Seite verhält sich wie die lokale Datei.

Plesk mit **reinem Nginx** (ohne Apache) liest `.htaccess` nicht. Dann unter *Apache & nginx-Einstellungen → Zusätzliche nginx-Anweisungen* eintragen:
```
index netzwerk-simulator.html;
add_header Content-Security-Policy "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" always;
```

## Sicherung und Löschung

- Alle Daten liegen als JSON-Dateien in `DATA_DIR` (`sessions/`, `classes/`, `feedback/`, `settings.json`). Abgelaufene Einträge löscht der Server selbständig (beim Start und danach regelmässig).
- Eine Sicherung ist nicht nötig und aus Datenschutzsicht auch nicht erwünscht: Sessions sind kurzlebige Arbeitsstände. Wer `DATA_DIR` trotzdem sichert, muss die Sicherungen ebenso kurz aufbewahren.
- Alles sofort löschen: App stoppen, Ordner `DATA_DIR` leeren, App starten.
