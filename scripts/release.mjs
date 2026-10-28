// Erzeugt release/netzwerk-simulator.html aus dem Build und prüft, dass die
// Datei ohne Internet funktioniert: keine Skripte, Stile, Schriften oder
// Bilder von fremden Servern und eine CSP, die Netzwerkzugriffe verbietet.
// Aufruf: npm run release (baut vorher mit "npm run verify").

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'index.html');
const target = join(root, 'release', 'netzwerk-simulator.html');

const html = readFileSync(source, 'utf8');
const problems = [];

// Externe Ressourcen, die der Browser laden würde.
const external = [
  /<script[^>]+src=["']?(https?:)?\/\//gi,
  /<link[^>]+href=["']?(https?:)?\/\//gi,
  /<img[^>]+src=["']?(https?:)?\/\//gi,
  /url\(\s*["']?(https?:)?\/\//gi,
  /@import\s+["']?(https?:)?\/\//gi,
];
for (const pattern of external) {
  for (const match of html.matchAll(pattern)) problems.push(`Externe Ressource: ${match[0].slice(0, 80)}`);
}
if (/<script[^>]+src=/i.test(html)) problems.push('Ausgelagertes Skript gefunden: Der Build muss eine einzige Datei sein.');
if (!/Content-Security-Policy[^>]+connect-src 'none'/.test(html)) problems.push('CSP mit connect-src \'none\' fehlt.');

// Lizenzhinweise der eingebauten Pakete (scripts/third-party-licenses.mjs).
const licensesFile = join(root, 'dist', 'third-party-licenses.json');
const packages = existsSync(licensesFile) ? JSON.parse(readFileSync(licensesFile, 'utf8')) : null;
if (!packages) problems.push('dist/third-party-licenses.json fehlt: Lizenz-Plugin lief nicht.');
if (!html.includes('id="third-party-licenses"')) problems.push('Lizenzhinweise fehlen in der HTML-Datei.');
for (const p of packages ?? []) {
  if (!p.text) problems.push(`Lizenztext für ${p.name} fehlt.`);
}

if (problems.length) {
  console.error('Release abgebrochen:\n  ' + problems.join('\n  '));
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
writeFileSync(join(root, 'release', 'THIRD_PARTY_NOTICES.md'), notices(packages));
const kb = Math.round(statSync(target).size / 1024);
console.log(`release/netzwerk-simulator.html erstellt (${kb} KB), offline geprüft.`);

function notices(list) {
  const parts = [
    '# Hinweise zu enthaltener Software',
    '',
    'Diese Datei wird von `npm run release` erzeugt. Sie listet die Pakete, deren Code in',
    '`netzwerk-simulator.html` eingebaut ist, mit ihren Lizenztexten. Dieselben Angaben zeigt',
    'der Simulator unter **Über**.',
    '',
    'Die Befehlszeile der Router und Switches ist an die Syntax von FRRouting (vtysh) angelehnt.',
    'Sie ist eine eigene Nachbildung und enthält keinen Code und keine Texte aus FRRouting.',
    '',
  ];
  for (const p of list) {
    parts.push(`## ${p.name} ${p.version} (${p.license})`, '', p.homepage ? `<${p.homepage.replace(/^git\+/, '')}>` : '', '', '```', p.text, '```', '');
  }
  return parts.join('\n');
}
