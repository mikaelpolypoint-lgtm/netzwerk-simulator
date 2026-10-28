// Erzeugt release/netzwerk-simulator.html aus dem Build und prüft, dass die
// Datei ohne Internet funktioniert: keine Skripte, Stile, Schriften oder
// Bilder von fremden Servern und eine CSP, die Netzwerkzugriffe verbietet.
// Aufruf: npm run release (baut vorher mit "npm run verify").

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
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

if (problems.length) {
  console.error('Release abgebrochen:\n  ' + problems.join('\n  '));
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
const kb = Math.round(statSync(target).size / 1024);
console.log(`release/netzwerk-simulator.html erstellt (${kb} KB), offline geprüft.`);
