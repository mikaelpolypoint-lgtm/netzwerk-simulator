# Herkunft und Rechte

Dieses Dokument hält fest, woher Code, Texte und Grafiken stammen. Es dient als Nachweis für Schulen und als Grundlage für die Lizenz. Stand: Oktober 2026, Version 0.4.

> Technische Bestandesaufnahme, keine Rechtsberatung.

## Ergebnis in Kürze

- Der Simulator ist eine **eigenständige Neuentwicklung**. Es wurde kein Code, kein Text und keine Grafik aus anderen Programmen übernommen.
- In die ausgelieferte Datei sind nur **zwei fremde Pakete** eingebaut, beide unter MIT-Lizenz. Ihre Lizenztexte werden mitgeliefert.
- Die Desktop-Version enthält zusätzlich Rust-Pakete von Tauri, alle unter freien Lizenzen (MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 u.a.). Alle Lizenztexte liegen in [`src-tauri/THIRD_PARTY_RUST.md`](../src-tauri/THIRD_PARTY_RUST.md).
- Jedes Release prüft das automatisch und bricht bei einer nicht freigegebenen Lizenz ab (`scripts/release-checks.mjs`, Bericht in `release/checks.json`).

## Eingebaute Software anderer

| Paket | Lizenz | Wofür | Nachweis |
|---|---|---|---|
| svelte | MIT | Oberflächen-Framework (Laufzeit) | `release/THIRD_PARTY_NOTICES.md`, im Programm unter **Über** |
| clsx | MIT | Hilfsfunktion von Svelte | ebenda |
| Tauri und Rust-Pakete | MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0 u.a. | nur Desktop-Version | `src-tauri/THIRD_PARTY_RUST.md` |

Nicht ausgeliefert, nur zum Bauen und Testen: Vite, TypeScript, Vitest, Playwright, svelte-check, vite-plugin-singlefile, Tauri-CLI. Diese Werkzeuge stehen ebenfalls unter freien Lizenzen. Die Release-Prüfung listet sie unter `licenses.tools`.

Alle diese Lizenzen sind mit MIT und mit (A)GPL-3.0 verträglich.

## Eigene Bestandteile

| Bestandteil | Herkunft |
|---|---|
| Simulationskern (`src/core`) | eigene Implementierung nach öffentlichen Standards (RFCs, IEEE 802, ITU-T), siehe [protokolle.md](protokolle.md) |
| Oberfläche (`src/ui`) | eigene Implementierung |
| Symbole (`Icon.svelte`, `DeviceIcon.svelte`) | eigene, einfache Zeichnungen als SVG-Pfade; keine Icon-Bibliothek |
| App-Symbol (`src-tauri/app-icon/icon.svg`) | eigene Zeichnung; die PNG-Grössen daraus erzeugt |
| Schriften | keine eingebetteten Schriften, es werden die Systemschriften genutzt |
| Texte, Hilfe, Übungen, Beispiele | eigene Texte |
| Server (`server/`) | eigene Implementierung, nur Node.js-Bordmittel |

## Vorbilder und Namen anderer

- **FILIUS** (Universität Siegen) und **Cisco Packet Tracer** waren Anlass und Vorbild für die Idee: ein Netzwerk-Simulator für den Unterricht. Übernommen wurde nur die Idee, kein Code, keine Grafik, keine Texte und keine Bedienoberfläche. Ideen und Unterrichtskonzepte sind urheberrechtlich nicht geschützt.
- **Befehlszeile:** Die Syntax lehnt sich an FRRouting und Cisco IOS an (`show ip route`, `router ospf` …). Befehlsnamen sind allgemein übliche Fachbegriffe. Die Implementierung ist eigenständig und enthält keinen Code aus diesen Systemen. FRRouting (GPL-2.0) steht in keiner Verbindung zum Projekt.
- **Herstellernamen** wie Cisco, Wireshark, Plesk, Windows oder macOS erscheinen nur beschreibend, etwa «Cisco-HDLC» als Name einer Kapselung oder «öffnen mit Wireshark». Sie sind Marken ihrer Inhaber.

## Beispieldaten

- **Domains:** `schule.example`, `firma.example`, `provider.example` und `example.com` sind nach RFC 2606 für Beispiele reserviert. Sie gehören niemandem.
- **IP-Adressen** in Übungen: private Netze (RFC 1918) und Dokumentationsnetze (RFC 5737: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).
- **MAC-Adressen:** lokal verwaltete Adressen `02:00:…`, keine Herstellerkennungen.
- **AS-Nummern:** private Nummern (64512–65534).
- **Mobilfunk:** Test-Netzkennung 001-01. Die GPON-Seriennummer beginnt mit der Fantasiekennung `DEMO`.
- **Namen in Beispielen** («Anna», «Ben», «PC Verwaltung») sind frei erfunden.

## Entwicklung mit KI

Der Simulator wurde mit Unterstützung einer KI (Claude von Anthropic) programmiert. Idee, Anforderungen, Unterrichtsbezug, Auswahl, Prüfung und Verantwortung liegen bei den Autoren. Die KI hat den Code nach deren Vorgaben geschrieben. Sie wurde angewiesen, nichts aus anderen Programmen zu übernehmen, und der Code ist durch über 280 automatische Tests abgesichert.

Wie weit KI-erzeugter Code urheberrechtlich geschützt ist, ist international noch nicht abschliessend geklärt. Für die Nutzung ändert das nichts: Die Lizenz erlaubt sie ausdrücklich, und fremde Rechte werden nicht verletzt.

## So bleibt es sauber

- Neue Pakete nur mit freigegebener Lizenz. Die Release-Prüfung bricht sonst ab (Liste `ALLOWED` in `scripts/third-party-licenses.mjs`).
- Keine Grafiken, Icons, Schriften oder Texte aus dem Internet kopieren. Fremdes Material nur mit klarer Lizenz, Quelle hier eintragen.
- Keine echten Domains, Personen oder Firmen in Beispielen. Für Domains `.example` verwenden.
