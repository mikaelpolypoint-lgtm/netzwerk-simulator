// Prüfungen bei jedem Release: Datenschutz, Sicherheit und Lizenzen.
// Das Ergebnis landet in release/checks.json; die Admin-Konsole der
// Webversion zeigt es unter «Prüfungen». Ein «fail» bricht das Release ab.
//
// Aufruf: node scripts/release-checks.mjs (läuft automatisch in npm run release)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED } from './third-party-licenses.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function files(dir, pattern) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...files(path, pattern));
    else if (pattern.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const checks = [];
const add = (category, id, status, detail) => checks.push({ id, category, status, detail });
const pass = (category, id, detail) => add(category, id, 'pass', detail);

export function runChecks({ html, packages }) {
  checks.length = 0;
  const server = read('server/app.cjs');
  const sources = files('src', /\.(ts|svelte)$/).map((f) => [f, read(f)]);

  // --- Datenschutz ---------------------------------------------------------------
  const external = [/<script[^>]+src=["']?(https?:)?\/\//i, /<link[^>]+href=["']?(https?:)?\/\//i, /<img[^>]+src=["']?(https?:)?\/\//i, /url\(\s*["']?(https?:)?\/\//i, /@import\s+["']?(https?:)?\/\//i];
  const found = external.filter((p) => p.test(html));
  add('privacy', 'privacy.noExternal', found.length ? 'fail' : 'pass', found.length ? `${found.length} externe Ressourcen in der HTML-Datei` : 'Keine Skripte, Stile, Schriften oder Bilder von fremden Servern.');

  const csp = /Content-Security-Policy[^>]+connect-src 'none'/.test(html);
  add('privacy', 'privacy.csp', csp ? 'pass' : 'fail', csp ? "CSP verbietet Netzwerkzugriffe (connect-src 'none'); die Webversion erlaubt nur den eigenen Server." : "CSP mit connect-src 'none' fehlt.");

  const trackers = /google-analytics|googletagmanager|gtag\(|plausible|matomo|hotjar|sentry|facebook\.net|doubleclick|clarity\.ms/i;
  const tracked = [['release', html], ['server/app.cjs', server], ...sources].filter(([, text]) => trackers.test(text)).map(([f]) => f);
  add('privacy', 'privacy.noTracking', tracked.length ? 'fail' : 'pass', tracked.length ? `Verdächtige Dienste in: ${tracked.join(', ')}` : 'Keine Analyse-, Tracking- oder Werbedienste.');

  const cookies = /set-cookie|document\.cookie/i.test(server) || sources.some(([, text]) => /document\.cookie/.test(text));
  add('privacy', 'privacy.noCookies', cookies ? 'fail' : 'pass', cookies ? 'Cookies gefunden.' : 'Weder Server noch Oberfläche setzen Cookies.');

  const keys = [...new Set(sources.flatMap(([, text]) => [...text.matchAll(/'(netzwerk-simulator\.[\w.-]+)'/g)].map((m) => m[1])))].sort();
  const personal = keys.filter((k) => /name|mail|user|person|student|klasse|account/i.test(k));
  add('privacy', 'privacy.storage', personal.length ? 'fail' : 'pass', personal.length ? `Verdächtige Schlüssel: ${personal.join(', ')}` : `Browser-Speicher nur für Technik: ${keys.join(', ') || '–'}`);

  // IP-Adressen nur gesalzen gehasht im Arbeitsspeicher (Ratenbegrenzung), nie in Dateien oder Logs.
  const ipLines = server.split('\n').filter((l) => /remoteAddress|x-forwarded-for/i.test(l));
  const hashed = /createHash\('sha256'\)\.update\(SALT\)\.update\(ip\)/.test(server);
  const logged = /console\.\w+\([^)]*(req\b|remoteAddress|headers)/.test(server);
  const ok = ipLines.length <= 1 && hashed && !logged;
  add('privacy', 'privacy.noIpLog', ok ? 'pass' : 'fail', ok ? 'IP-Adressen nur als gesalzener Hash im Arbeitsspeicher, kein Zugriffsprotokoll.' : 'IP-Adressen werden möglicherweise gespeichert oder protokolliert.');

  const retention = /retention|expires|ttl/i.test(server);
  add('privacy', 'privacy.retention', retention ? 'pass' : 'warn', retention ? 'Sessions, Klassen und Rückmeldungen haben ein Ablaufdatum und werden automatisch gelöscht.' : 'Keine automatische Löschung gefunden.');

  // --- Sicherheit ----------------------------------------------------------------
  const requires = [...server.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  const foreign = requires.filter((r) => !r.startsWith('node:') && !r.startsWith('.'));
  add('security', 'security.serverDeps', foreign.length ? 'warn' : 'pass', foreign.length ? `Fremde Module: ${foreign.join(', ')}` : 'Server nutzt nur Node.js-Bordmittel, keine npm-Pakete.');

  const pkg = JSON.parse(read('package.json'));
  const runtime = Object.keys(pkg.dependencies ?? {});
  add('security', 'security.runtimeDeps', runtime.length ? 'warn' : 'pass', runtime.length ? `Laufzeitabhängigkeiten: ${runtime.join(', ')}` : 'Keine Laufzeitabhängigkeiten; nur Build-Werkzeuge.');

  let audit;
  try {
    const out = execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 });
    audit = JSON.parse(out);
  } catch (error) {
    try {
      audit = JSON.parse(error.stdout ?? '');
    } catch {
      audit = null;
    }
  }
  if (!audit?.metadata) {
    add('security', 'security.audit', 'skipped', 'npm audit nicht erreichbar (offline).');
  } else {
    const v = audit.metadata.vulnerabilities ?? {};
    const severe = (v.high ?? 0) + (v.critical ?? 0);
    const total = Object.values(v).reduce((a, b) => a + b, 0);
    add('security', 'security.audit', severe ? 'warn' : 'pass', total ? `Build-Werkzeuge: ${total} bekannte Schwachstellen (${severe} hoch/kritisch). Sie sind nicht in der ausgelieferten Datei.` : 'Keine bekannten Schwachstellen.');
  }

  const headers = ['X-Content-Type-Options', 'Referrer-Policy', 'Content-Security-Policy', "frame-ancestors 'none'"].filter((h) => !server.includes(h));
  add('security', 'security.headers', headers.length ? 'fail' : 'pass', headers.length ? `Fehlt: ${headers.join(', ')}` : 'Sicherheits-Header gesetzt (CSP, nosniff, no-referrer, kein Einbetten).');

  const evalUse = /\beval\(|new Function\(/.test(html);
  add('security', 'security.noEval', evalUse ? 'warn' : 'pass', evalUse ? 'eval oder new Function in der HTML-Datei.' : 'Kein eval und kein new Function im ausgelieferten Code.');

  const admin = /timingSafeEqual/.test(server) && /ADMIN_PASSWORD/.test(server);
  add('security', 'security.admin', admin ? 'pass' : 'fail', admin ? 'Admin nur mit ADMIN_PASSWORD, Vergleich in konstanter Zeit, Token nur im Arbeitsspeicher.' : 'Admin-Schutz unvollständig.');

  // --- Lizenzen -------------------------------------------------------------------
  const bad = (packages ?? []).filter((p) => !ALLOWED.includes(p.license));
  add('licenses', 'licenses.bundled', !packages ? 'fail' : bad.length ? 'fail' : 'pass', !packages ? 'Lizenzliste fehlt.' : bad.length ? `Nicht freigegeben: ${bad.map((p) => `${p.name} (${p.license})`).join(', ')}` : `${packages.length} eingebaute Pakete: ${packages.map((p) => `${p.name} ${p.license}`).join(', ')}`);

  const missingText = (packages ?? []).filter((p) => !p.text);
  add('licenses', 'licenses.notices', missingText.length || !html.includes('id="third-party-licenses"') ? 'fail' : 'pass', missingText.length ? `Lizenztext fehlt: ${missingText.map((p) => p.name).join(', ')}` : 'Lizenztexte sind in der Datei eingebettet und unter «Über» sichtbar.');

  const own = existsSync(join(root, 'LICENSE')) && /MIT License/.test(read('LICENSE'));
  add('licenses', 'licenses.own', own ? 'pass' : 'fail', own ? `Eigener Code unter MIT (${pkg.author}).` : 'LICENSE fehlt oder ist nicht MIT.');

  const dev = Object.keys(pkg.devDependencies ?? {}).flatMap((name) => {
    const file = join(root, 'node_modules', name, 'package.json');
    if (!existsSync(file)) return [];
    const p = JSON.parse(readFileSync(file, 'utf8'));
    const license = typeof p.license === 'string' ? p.license : (p.license?.type ?? 'UNKNOWN');
    return ALLOWED.includes(license) || /^\(?(MIT|Apache-2\.0)( OR |\))/.test(license) ? [] : [`${name} (${license})`];
  });
  add('licenses', 'licenses.tools', dev.length ? 'warn' : 'pass', dev.length ? `Werkzeuge mit anderer Lizenz (nicht ausgeliefert): ${dev.join(', ')}` : 'Alle Build-Werkzeuge mit freier Lizenz.');

  return { version: pkg.version, date: new Date().toISOString(), checks: [...checks] };
}

export function writeReport(report) {
  writeFileSync(join(root, 'release', 'checks.json'), JSON.stringify(report, null, 2) + '\n');
}

// Direkt aufgerufen: gegen die bestehende Release-Datei prüfen.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = read('release/netzwerk-simulator.html');
  const licenses = join(root, 'dist', 'third-party-licenses.json');
  const packages = existsSync(licenses) ? JSON.parse(readFileSync(licenses, 'utf8')) : null;
  const report = runChecks({ html, packages });
  writeReport(report);
  for (const c of report.checks) console.log(`${c.status.padEnd(7)} ${c.id}: ${c.detail}`);
  if (report.checks.some((c) => c.status === 'fail')) process.exit(1);
}
