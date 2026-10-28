# Desktop-Version (Windows, macOS, Linux)

Die Desktop-Version ist dieselbe HTML-Datei wie die Web-Version, verpackt mit [Tauri](https://tauri.app) in ein eigenes Programmfenster. Sie nutzt die Browser-Engine des Betriebssystems (Windows: WebView2/Edge, macOS: WebKit/Safari, Linux: WebKitGTK), darum sind die Installer klein (2–10 MB).

## Installer bekommen

GitHub baut die Installer automatisch:

- **Mit einem Versions-Tag**: Version in `package.json` erhöhen, dann
  ```bash
  git tag v0.2.0
  git push origin v0.2.0
  ```
- **Zum Testen ohne Tag**: auf GitHub *Actions → Desktop → Run workflow*.

Nach 10–20 Minuten liegt unter *Releases* ein **Entwurf** mit allen Dateien. Prüfen und dann veröffentlichen.

| System | Datei |
|---|---|
| Windows | `.msi` oder `…-setup.exe` |
| macOS (Intel und Apple Silicon) | `.dmg` |
| Linux | `.deb` (Debian/Ubuntu), `.rpm` (Fedora), `.AppImage` (alle) |

## Warnungen beim ersten Start

Die Installer sind **nicht signiert** (Signaturzertifikate kosten Geld). Darum:

- **Windows**: SmartScreen meldet «Der Computer wurde durch Windows geschützt» → *Weitere Informationen* → *Trotzdem ausführen*.
- **macOS**: «kann nicht geöffnet werden, da der Entwickler nicht verifiziert werden kann» → im Finder Rechtsklick auf die App → *Öffnen* → *Öffnen*. Bei neueren macOS-Versionen: *Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen*.

Für eine Verteilung an viele Schulgeräte lohnt sich später ein Zertifikat (Windows: Code-Signing-Zertifikat; macOS: Apple Developer Program). Tauri unterstützt beides über GitHub-Secrets.

## Lokal bauen

Voraussetzungen: Node.js 20+, [Rust](https://rustup.rs) und die [Tauri-Voraussetzungen](https://tauri.app/start/prerequisites/) des Systems (Linux: `libwebkit2gtk-4.1-dev` u.a.).

```bash
npm ci
npm run desktop:dev     # Fenster mit Entwicklungsserver, Änderungen sofort sichtbar
npm run desktop:build   # Installer für das eigene System in src-tauri/target/release/bundle/
```

## Lizenzen

- Tauri und alle Rust-Pakete stehen unter freien Lizenzen (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, MPL-2.0). Die zulässigen Lizenzen stehen in `src-tauri/about.toml`; ein Paket mit anderer Lizenz bricht den Build ab.
- Die Lizenztexte werden mitgeliefert: `THIRD_PARTY_NOTICES.md` (Web-Teil) und `THIRD_PARTY_RUST.md` (Rust-Pakete, erzeugt mit `cargo about generate about.hbs -o THIRD_PARTY_RUST.md` im Ordner `src-tauri`).
- Einige Rust-Pakete (cssparser, selectors u.a. aus dem Servo-Projekt) stehen unter MPL-2.0. Sie werden unverändert verwendet; MPL verlangt dann nur, dass der Bezugsort des Quellcodes genannt wird. Das steht in `THIRD_PARTY_RUST.md`.
- Das Programmsymbol ist eigenes Material (aus dem Favicon des Simulators).

## Speichern und Öffnen

Wie im Browser: *Speichern* legt die Projektdatei im Download-Ordner ab, *Öffnen* zeigt die Dateiauswahl des Systems.
