# Datenschutz

leyoNET ist so gebaut, dass er **keine Personendaten** braucht und keine speichert. Dieses Dokument beschreibt, was wo verarbeitet wird, und dient Schulen als Grundlage für ihre eigene Datenschutzerklärung. Der Text im Simulator (**Hilfe → Datenschutz**) fasst dasselbe für Lernende zusammen.

> Hinweis: Dies ist eine technische Beschreibung, keine Rechtsberatung. Verantwortlich im Sinne von revDSG und DSGVO ist, wer eine Webversion betreibt (in der Regel die Schule). Bei Unsicherheit die kantonale bzw. schulinterne Datenschutzstelle beiziehen.

## Grundsätze

Das Konzept folgt dem Schweizer Datenschutzgesetz (revDSG, in Kraft seit 1.9.2023) und der EU-Datenschutz-Grundverordnung (DSGVO):

- **Datenvermeidung** (Art. 6 Abs. 2 revDSG, Art. 5 Abs. 1 lit. c DSGVO): keine Konten, keine Namen, keine E-Mail-Adressen, keine Geräte-Kennungen, kein Tracking, keine Analyse-Dienste, keine Werbung, keine Cookies, keine externen Schriften oder CDNs.
- **Datenschutz durch Technikgestaltung und Voreinstellungen** (Art. 7 revDSG, Art. 25 DSGVO): Die lokale Datei und die Desktop-Version können technisch keine Verbindung aufbauen (Content-Security-Policy `connect-src 'none'`). Die Webversion spricht ausschliesslich mit dem eigenen Server (`connect-src 'self'`).
- **Speicherbegrenzung**: Alles auf dem Server hat ein Ablaufdatum und wird automatisch gelöscht.
- **Zweckbindung**: Gespeichert wird nur, was für die Übung nötig ist: die Netzwerk-Konfiguration.

## Lokale Datei und Desktop-Version

| Was | Wo | Dauer |
|---|---|---|
| Aktuelles Projekt (Autosave) inkl. Snapshots | IndexedDB im Browserprofil bzw. im App-Datenordner | bis «Neues Netz» oder Löschen der Browserdaten |
| Sprache, Darstellung (hell/dunkel), Funktionsprofil bzw. Funktionsauswahl, Währung, Adressanzeige ein/aus | `localStorage` | bis Löschen der Browserdaten |
| Gespeicherte Projekte und Funktionsdateien | `.json`-Dateien, die die Person selbst ablegt | liegt in ihrer Hand |

Projektdateien enthalten Geräte, Kabel, Adressen und Konfiguration, auch Webseiten und Bilder, die auf einem simulierten Webserver liegen. Bilder werden beim Hochladen auf höchstens 480 Pixel verkleinert und neu kodiert, dabei gehen Metadaten wie Ort und Kamera verloren (EXIF). Trotzdem gilt: **keine Fotos von Personen hochladen.** Gerätenamen sind frei wählbar; sie sollten neutral sein («PC 1», nicht «PC Anna»).

Es wird nichts übertragen. Die Admin-Konsole, Sessions und Rückmeldungen sind hier ausgegraut.

## Webversion (Node.js-Server)

### Sessions

- Inhalt: nur die **Projektdatei** (Geräte, Kabel, IP-Konfiguration, Dokumentationsbereiche, Snapshots, Inhalte simulierter Webserver) und technische Metadaten (Erstellungs- und Ablaufzeit, optional der Klassencode).
- Schlüssel: ein **Zufallscode** (z.B. `DHGT-V8SS`, rund 40 Bit Zufall aus `crypto.randomInt`). Wer den Code kennt, kann die Session öffnen; der Code ist keiner Person zugeordnet.
- Löschung: automatisch nach der eingestellten Zeit ohne Änderung (Standard **24 Stunden**, Admin wählbar 1 Stunde bis 30 Tage) oder sofort mit **Session löschen**.
- Im Browser wird nur der Code in `localStorage` gemerkt, damit die Session nach einem Neuladen weiterläuft. Eine neue Session beginnt immer leer.

### Klassen-Sessions

- Die Lehrperson eröffnet in der Admin-Konsole eine Klasse mit einer **Bezeichnung ohne Personenbezug** (z.B. «INF22a»). Lernende treten mit dem Klassencode bei.
- Die Lehrperson sieht die Session-Codes und kann die Arbeiten öffnen, aber **keine Namen**. Wer welche Session hat, klärt die Klasse mündlich oder über den Code, ohne dass der Server davon weiss.
- Löschung: automatisch nach der eingestellten Zeit (Standard 14 Tage) oder mit **Schliessen**.

### Rückmeldungen

- Inhalt: Art (Problem/Idee), der eingegebene Text (max. 2000 Zeichen), Programmversion, Sprache, Zeitpunkt, optional eine Kopie des aktuellen Netzes (nur wenn die Person das Häkchen setzt, damit der Admin das Problem nachvollziehen kann).
- Das Formular weist darauf hin, **keine Namen oder anderen Personendaten** einzugeben. Freitext kann das technisch nicht verhindern; der Admin löscht solche Rückmeldungen.
- Löschung: automatisch nach der eingestellten Zeit (Standard 30 Tage) oder einzeln in der Admin-Konsole.

### Admin

- Ein einziges Passwort aus der Umgebungsvariable `ADMIN_PASSWORD`; es wird nicht gespeichert. Die Anmeldung erzeugt ein Token, das nur im Arbeitsspeicher des Servers und der geöffneten Seite liegt (höchstens 8 Stunden gültig, endet mit dem Neuladen der Seite).

### Was der Server nicht speichert

- **Keine IP-Adressen**, keine User-Agents, keine Referrer. Der Server schreibt kein Zugriffsprotokoll.
- Gegen Missbrauch zählt eine Ratenbegrenzung Anfragen pro Minute. Dafür hält sie einen **gesalzenen Hash** der IP-Adresse höchstens wenige Minuten im Arbeitsspeicher; das Salz wird bei jedem Start neu erzeugt und nie gespeichert. Nach einem Neustart oder nach Ablauf lässt sich nichts mehr zurückführen.
- Keine Cookies. Antworten der API tragen `Cache-Control: no-store`.

### Webserver-Protokolle

Vor dem Node.js-Server steht bei Plesk ein Webserver (Apache/Nginx), der **eigene Zugriffsprotokolle mit IP-Adressen** führen kann. Das liegt ausserhalb des Simulators und muss beim Hosting eingestellt werden:

- Protokollierung für die Subdomain abschalten oder
- die Aufbewahrung kurz halten (Plesk: *Protokolle → Protokollrotation*, z.B. täglich rotieren, 7 Dateien behalten), und
- in der Datenschutzerklärung der Schule erwähnen.

Auch ein vorgeschaltetes CDN oder ein Reverse-Proxy kann protokollieren.

## Prüfung bei jedem Release

`npm run release` führt `scripts/release-checks.mjs` aus und bricht bei einem Fehler ab. Das Ergebnis steht in `release/checks.json` und in der Webversion unter **Admin-Konsole → Prüfungen**. Geprüft wird automatisch:

| Bereich | Prüfung |
|---|---|
| Datenschutz | keine externen Ressourcen in der HTML-Datei; CSP `connect-src 'none'`; keine Analyse-, Tracking- oder Werbedienste; keine Cookies; Browser-Speicher nur mit technischen Schlüsseln; IP-Adressen nur gesalzen gehasht im Arbeitsspeicher, kein Zugriffsprotokoll; automatische Löschfristen |
| Sicherheit | Server ohne npm-Pakete; keine Laufzeitabhängigkeiten; `npm audit` der Build-Werkzeuge; Sicherheits-Header (CSP, nosniff, no-referrer, kein Einbetten); kein `eval`; Admin nur mit Passwort, Vergleich in konstanter Zeit |
| Lizenzen | eingebaute Pakete nur mit freigegebener Lizenz; Lizenztexte eingebettet; eigener Code unter AGPL-3.0 mit Link zum Quellcode in der App; Lizenzen der Build-Werkzeuge |

Die Prüfung ersetzt keine rechtliche Beurteilung, verhindert aber, dass sich unbemerkt ein Tracker, eine externe Schrift oder eine unpassende Lizenz einschleicht.

## Ort der Daten

Alle Daten liegen als JSON-Dateien im Ordner `DATA_DIR` auf dem Server der Schule (Dateirechte `0600`, Ordner `0700`). Es gibt keine Drittanbieter und keine Übermittlung ins Ausland, sofern das Hosting selbst in der Schweiz bzw. im EWR steht.

## Rechte der betroffenen Personen

Da keine Daten einer bestimmten Person zugeordnet werden, gibt es in der Regel nichts herauszugeben. Sessions kann jede Person selbst sofort löschen. Für Rückmeldungen und Klassen wendet man sich an den Betreiber, der sie in der Admin-Konsole löscht; ansonsten verschwinden sie automatisch nach Ablauf der Frist.

## Vorlage für die Datenschutzerklärung der Schule

> **leyoNET.** Die Webversion von leyoNET unter *‹Adresse›* wird von *‹Schule›* betrieben. Sie speichert nur technische Netzwerk-Konfigurationen unter einem Zufallscode, ohne Namen, Konten oder E-Mail-Adressen. Arbeitsstände werden nach *‹24 Stunden›* ohne Änderung automatisch gelöscht, Klassen nach *‹14 Tagen›*, Rückmeldungen nach *‹30 Tagen›*. Der Simulator setzt keine Cookies, nutzt keine Analyse- oder Werbedienste und speichert keine IP-Adressen. Der Webserver führt Zugriffsprotokolle, die nach *‹7 Tagen›* gelöscht werden. Kontakt: *‹Adresse der Datenschutzverantwortlichen›*.
