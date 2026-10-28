# Testversion auf Plesk

Der Branch `develop` ist der Entwicklungsstand. Plesk holt ihn direkt von GitHub und liefert die fertige Datei `release/netzwerk-simulator.html` aus. Auf dem Server wird nichts gebaut, Node.js ist nicht nötig.

```
Rechner (du)  ──git push──►  GitHub: develop  ──Plesk Git (Pull)──►  test.deine-domain.ch
```

## Einmalig einrichten

1. **Subdomain anlegen**, z.B. `simulator-test.deine-domain.ch` (Websites & Domains → Subdomain hinzufügen).
2. **Git hinzufügen**: bei der Subdomain auf **Git** klicken.
   - Repository: **Remote-Git-Hosting**
   - URL: `https://github.com/mikaelpolypoint-lgtm/netzwerk-simulator.git`
     (bei einem privaten Repository die SSH-URL `git@github.com:mikaelpolypoint-lgtm/netzwerk-simulator.git` wählen und den von Plesk angezeigten SSH-Schlüssel auf GitHub unter *Settings → Deploy keys* eintragen, nur Lesezugriff)
   - Bereitstellungsmodus: **Automatisch**
   - Serverpfad: `/httpdocs`
3. Nach dem Anlegen in den Git-Einstellungen den **Branch auf `develop`** stellen.
4. **Dokumentstamm** der Subdomain auf `httpdocs/release` ändern (Hosting-Einstellungen). So ist nur der fertige Simulator erreichbar, nicht der Quellcode.
5. Die Datei `release/.htaccess` sorgt dafür, dass die Adresse ohne Dateinamen direkt den Simulator öffnet, und setzt dieselben Sicherheits-Header wie der Docker-Server.
6. **SSL/TLS** für die Subdomain aktivieren (Let's Encrypt in Plesk).

## Automatisch aktualisieren nach jedem Push

In Plesk unter *Git → Repository-Einstellungen* steht eine **Webhook-URL**. Diese auf GitHub eintragen:

*Repository → Settings → Webhooks → Add webhook*
- Payload URL: die Webhook-URL aus Plesk
- Content type: `application/json`
- Events: *Just the push event*

Ohne Webhook in Plesk einfach auf **Pull Updates** klicken.

## Ablauf im Alltag

```bash
git switch develop
git pull                 # Stand von GitHub holen
# … ändern …
npm run release          # Tests, Build, release/netzwerk-simulator.html neu erzeugen
git add -A
git commit -m "Was geändert wurde"
git push                 # Plesk zieht den neuen Stand
```

Wichtig: Plesk liefert die **eingecheckte** Datei `release/netzwerk-simulator.html` aus. Ohne `npm run release` vor dem Commit bleibt die Testversion auf dem alten Stand. Die CI auf GitHub meldet das mit einem roten Kreuz.

## Stabile Version

Ist der Stand auf `develop` gut, wird er nach `main` übernommen (Pull Request auf GitHub oder lokal `git switch main && git merge develop && git push`). Eine zweite Subdomain kann auf gleiche Weise den Branch `main` ausliefern.

## Hinweise

- Plesk mit **reinem Nginx** (ohne Apache) liest `.htaccess` nicht. Dann unter *Apache & nginx-Einstellungen → Zusätzliche nginx-Anweisungen* eintragen:
  ```
  index netzwerk-simulator.html;
  add_header Content-Security-Policy "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" always;
  ```
- Der Simulator speichert nichts auf dem Server. Arbeitsstände bleiben im Browser der Lernenden oder als `.json`-Datei bei ihnen.
