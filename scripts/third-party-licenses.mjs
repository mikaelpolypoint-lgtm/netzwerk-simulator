// Vite-Plugin: sammelt die Lizenzen aller Pakete, deren Code tatsächlich in
// der ausgelieferten HTML-Datei landet (z.B. die Svelte-Laufzeit), und bettet
// die Lizenztexte in die Datei ein. MIT, ISC, BSD und Apache verlangen, dass
// der Copyright-Hinweis jede Kopie begleitet; die Oberfläche zeigt sie unter
// «Über / Lizenzen» an.
//
// Der Build bricht ab, wenn ein Paket eine Lizenz hat, die nicht in ALLOWED
// steht. Neue Lizenzen erst prüfen und dann bewusst ergänzen.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

export const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];

/** Paketordner aus einem Modulpfad, z.B. …/node_modules/@scope/name/x.js → …/node_modules/@scope/name */
function packageRoot(id) {
  const clean = id.replace(/^\0/, '').split('?')[0];
  const marker = `${sep}node_modules${sep}`;
  const at = clean.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = clean.slice(at + marker.length).split(sep);
  const depth = rest[0].startsWith('@') ? 2 : 1;
  return clean.slice(0, at + marker.length) + rest.slice(0, depth).join(sep);
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

export function collectPackages(roots) {
  const packages = [];
  for (const dir of [...roots].sort()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN';
    packages.push({
      name: pkg.name,
      version: pkg.version,
      license,
      homepage: pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) ?? '',
      text: licenseText(dir),
    });
  }
  return packages;
}

export function checkPackages(packages) {
  const problems = [];
  for (const p of packages) {
    if (!ALLOWED.includes(p.license)) problems.push(`${p.name}@${p.version}: Lizenz "${p.license}" ist nicht freigegeben`);
    if (!p.text) problems.push(`${p.name}@${p.version}: keine LICENSE-Datei gefunden`);
  }
  return problems;
}

export function thirdPartyLicenses({ outFile = 'dist/third-party-licenses.json' } = {}) {
  const roots = new Set();
  let packages = [];
  return {
    name: 'third-party-licenses',
    apply: 'build',
    // Nur Module mit gerendertem Code zählen; reine Typ-Importe oder
    // vollständig wegoptimierte Module landen nicht in der Datei.
    renderChunk(_code, chunk) {
      for (const [id, info] of Object.entries(chunk.modules)) {
        if (info.renderedLength === 0) continue;
        const root = packageRoot(id);
        if (root && existsSync(join(root, 'package.json'))) roots.add(root);
      }
      return null;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        packages = collectPackages(roots);
        const problems = checkPackages(packages);
        if (problems.length) throw new Error('Lizenzprüfung fehlgeschlagen:\n  ' + problems.join('\n  '));
        // Als Kommentar für alle, die die Datei im Editor öffnen …
        const comment =
          '<!--\n  leyoNET – AGPL-3.0-or-later, Copyright (C) 2026 Mark von Allmen und Mikael von Allmen.\n  Quellcode: https://github.com/vonam-git/leyoNET – Name und Logo sind nicht Teil der Lizenz.\n' +
          '  Enthält Code folgender Pakete (vollständige Lizenztexte unter «Über / Lizenzen»):\n' +
          packages.map((p) => `    ${p.name} ${p.version} (${p.license})`).join('\n') +
          '\n-->';
        // … und als Daten für den Dialog. Ein JSON-Skript wird nie ausgeführt.
        const json = JSON.stringify(packages).replace(/</g, '\\u003c');
        const data = `<script type="application/json" id="third-party-licenses">${json}</script>`;
        return html.replace('<head>', `<head>\n    ${comment}`).replace('</body>', `  ${data}\n  </body>`);
      },
    },
    closeBundle() {
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, JSON.stringify(packages, null, 2));
    },
  };
}
