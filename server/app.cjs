'use strict';
/**
 * Server der Webversion des Netzwerk-Simulators.
 *
 * Liefert die fertige Datei release/netzwerk-simulator.html aus und bietet eine
 * kleine JSON-API für
 *   - Sessions: technische Projektstände unter einem Zufallscode, die nach
 *     einer einstellbaren Zeit automatisch gelöscht werden,
 *   - Klassen-Sessions: Lehrpersonen sehen die Sessions ihrer Klasse,
 *   - Rückmeldungen (Probleme, Ideen) an den Admin,
 *   - das Admin-Dashboard (Einstellungen, Klassen, Rückmeldungen).
 *
 * Datenschutz (revDSG / DSGVO): Es gibt keine Konten, keine Namen, keine
 * E-Mail-Adressen. Gespeichert werden nur Netzwerk-Konfigurationen. IP-Adressen
 * werden nicht gespeichert und nicht protokolliert; die Ratenbegrenzung hält
 * nur einen gesalzenen Hash für wenige Minuten im Arbeitsspeicher.
 *
 * Nur Node.js-Bordmittel, keine Abhängigkeiten. Start: node server/start.cjs
 * Umgebung: PORT, ADMIN_PASSWORD (ohne: Admin gesperrt), DATA_DIR.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const RELEASE_FILE = path.join(ROOT, 'release', 'netzwerk-simulator.html');
const NOTICES_FILE = path.join(ROOT, 'release', 'THIRD_PARTY_NOTICES.md');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_FEEDBACK_TEXT = 2000;
const ADMIN_TOKEN_HOURS = 8;

/** Feature-IDs dürfen nur aus Buchstaben, Ziffern und Punkten bestehen (Liste in src/ui/features.ts). */
const FEATURE_ID = /^[a-z]+\.[A-Za-z0-9]+$/;
const CHECKS_FILE = path.join(ROOT, 'release', 'checks.json');

const DEFAULT_SETTINGS = {
  modes: { design: true, simulation: true },
  /** Funktionsumfang: höchstes und voreingestelltes Profil (1 = 1. Lehrjahr … 5 = Studium), gesperrte Funktionen. */
  maxLevel: 5,
  defaultLevel: 2,
  disabled: [],
  sessionHours: 24,
  feedbackEnabled: true,
  feedbackDays: 30,
  classHours: 24 * 14,
};

// --- Speicher ------------------------------------------------------------------

const dirs = {
  sessions: path.join(DATA_DIR, 'sessions'),
  feedback: path.join(DATA_DIR, 'feedback'),
  classes: path.join(DATA_DIR, 'classes'),
};

function ensureDirs() {
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomar schreiben: erst Temporärdatei, dann umbenennen. */
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function remove(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // schon weg
  }
}

function settings() {
  const stored = readJson(path.join(DATA_DIR, 'settings.json')) || {};
  // Ältere Einstellungen: Modi design/action/doc und Schalter «pro».
  const modes = stored.modes || {};
  const migrated = {
    design: modes.design !== false,
    simulation: (modes.simulation !== undefined ? modes.simulation : modes.action) !== false,
  };
  const maxLevel = Number.isInteger(stored.maxLevel) ? stored.maxLevel : stored.pro === false ? 3 : DEFAULT_SETTINGS.maxLevel;
  const { pro: _pro, ...rest } = stored;
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    modes: migrated,
    maxLevel,
    defaultLevel: Math.min(Number.isInteger(stored.defaultLevel) ? stored.defaultLevel : DEFAULT_SETTINGS.defaultLevel, maxLevel),
    disabled: Array.isArray(stored.disabled) ? stored.disabled.filter((f) => typeof f === 'string' && FEATURE_ID.test(f)) : [],
  };
}

// --- Codes -----------------------------------------------------------------------

/** Ohne leicht verwechselbare Zeichen (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalisiert Eingaben wie «k7f2 9qxm» → «K7F2-9QXM»; null bei ungültigem Format. */
function normalizeCode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 8 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

const fileFor = (dir, code) => path.join(dir, `${code}.json`);

// --- Projekte prüfen ---------------------------------------------------------------

/** Nur Projekte des Simulators annehmen; Inhalt bleibt sonst unangetastet. */
function validProject(project) {
  return (
    project &&
    typeof project === 'object' &&
    project.meta &&
    project.meta.format === 'netzwerk-simulator' &&
    project.topology &&
    Array.isArray(project.topology.devices)
  );
}

function summary(project) {
  const t = project.topology;
  return {
    devices: t.devices.length,
    cables: Array.isArray(t.cables) ? t.cables.length : 0,
    task: project.tasks && typeof project.tasks.title === 'string' ? project.tasks.title.slice(0, 120) : null,
  };
}

// --- Ratenbegrenzung (nur im Arbeitsspeicher) ----------------------------------------

const SALT = crypto.randomBytes(16);
const buckets = new Map();

function limited(req, kind, perMinute) {
  const ip = req.socket.remoteAddress || '';
  const key = crypto.createHash('sha256').update(SALT).update(ip).update(kind).digest('base64url').slice(0, 16);
  const now = Date.now();
  const bucket = buckets.get(key) || { start: now, count: 0 };
  if (now - bucket.start > 60_000) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count++;
  buckets.set(key, bucket);
  return bucket.count > perMinute;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.start > 120_000) buckets.delete(key);
}, 60_000).unref();

// --- Admin-Anmeldung -----------------------------------------------------------------

const tokens = new Map();

function checkPassword(given) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function isAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expires = tokens.get(token);
  if (!expires || expires < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

// --- Aufräumen ---------------------------------------------------------------------

function cleanup() {
  const now = Date.now();
  for (const dir of [dirs.sessions, dirs.feedback, dirs.classes]) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      if (name.endsWith('.tmp')) {
        remove(file);
        continue;
      }
      const item = readJson(file);
      if (!item || typeof item.expires !== 'number' || item.expires < now) remove(file);
    }
  }
}

// --- HTTP-Hilfen ---------------------------------------------------------------------

// Skripte und das Stylesheet liefert der Server als eigene Dateien aus ('self'),
// damit die Seite auch läuft, wenn das Hosting zusätzlich eine strengere
// Richtlinie ohne 'unsafe-inline' setzt. Inline-Stile bleiben für style-Attribute nötig.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src data: blob:',
  "connect-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, value) {
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });
}

function fail(res, status, code) {
  json(res, status, { error: code });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('tooLarge'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalidJson'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Die App mit freigegebener API: CSP erlaubt Anfragen an den eigenen Server.
 * Eingebettete Skripte und das Stylesheet werden herausgelöst und unter
 * /assets/… ausgeliefert, damit keine Inline-Skripte nötig sind.
 */
function appBundle() {
  let html = fs.readFileSync(RELEASE_FILE, 'utf8');
  const assets = new Map();
  let n = 0;
  const extract = (open, close, make) => {
    for (;;) {
      const start = html.indexOf(open);
      if (start < 0) return;
      const bodyStart = start + open.length;
      const end = html.indexOf(close, bodyStart);
      if (end < 0) return;
      const tag = make(html.slice(bodyStart, end), n++);
      html = html.slice(0, start) + tag + html.slice(end + close.length);
    }
  };
  // Modul-Skript (der Simulator) und klassische Skripte (Startanzeige); JSON-Daten bleiben eingebettet.
  extract('<script type="module" crossorigin>', '</script>', (code, i) => {
    assets.set(`/assets/app-${i}.js`, { type: 'text/javascript; charset=utf-8', body: code });
    return `<script type="module" src="/assets/app-${i}.js"></script>`;
  });
  extract('<script>', '</script>', (code, i) => {
    assets.set(`/assets/boot-${i}.js`, { type: 'text/javascript; charset=utf-8', body: code });
    return `<script src="/assets/boot-${i}.js"></script>`;
  });
  extract('<style rel="stylesheet" crossorigin>', '</style>', (css, i) => {
    assets.set(`/assets/style-${i}.css`, { type: 'text/css; charset=utf-8', body: css });
    return `<link rel="stylesheet" href="/assets/style-${i}.css" />`;
  });
  html = html
    // frame-ancestors wirkt nur als HTTP-Header; im Meta-Tag würde der Browser warnen.
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${CSP.replace("; frame-ancestors 'none'", '')}" />`)
    .replace('<head>', '<head>\n    <meta name="ns-server" content="1" />');
  return { html, assets };
}

let cached = null;
let cachedMtime = 0;
function bundle() {
  const mtime = fs.statSync(RELEASE_FILE).mtimeMs;
  if (!cached || mtime !== cachedMtime) {
    cached = appBundle();
    cachedMtime = mtime;
  }
  return cached;
}

function html() {
  return bundle().html;
}

// --- API ---------------------------------------------------------------------------

function publicConfig() {
  const s = settings();
  return {
    policy: { modes: s.modes, maxLevel: s.maxLevel, defaultLevel: s.defaultLevel, disabled: s.disabled, sessionHours: s.sessionHours },
    feedbackEnabled: s.feedbackEnabled,
    feedbackDays: s.feedbackDays,
    admin: !!ADMIN_PASSWORD,
  };
}

function loadSession(code) {
  const item = readJson(fileFor(dirs.sessions, code));
  return item && item.expires > Date.now() ? item : null;
}

function loadClass(code) {
  const item = readJson(fileFor(dirs.classes, code));
  return item && item.expires > Date.now() ? item : null;
}

async function api(req, res, url) {
  const method = req.method || 'GET';
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // ohne «api»

  if (parts[0] === 'config' && method === 'GET') return json(res, 200, publicConfig());

  // --- Sessions ---
  if (parts[0] === 'sessions') {
    if (limited(req, 'sessions', 120)) return fail(res, 429, 'rateLimited');
    const s = settings();
    const ttl = s.sessionHours * 3_600_000;

    if (parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      if (!validProject(body.project)) return fail(res, 400, 'invalidProject');
      let classCode = null;
      if (body.classCode) {
        classCode = normalizeCode(body.classCode);
        if (!classCode || !loadClass(classCode)) return fail(res, 404, 'unknownClass');
      }
      let code = newCode();
      while (fs.existsSync(fileFor(dirs.sessions, code))) code = newCode();
      const now = Date.now();
      const item = { code, created: now, updated: now, expires: now + ttl, classCode, project: body.project };
      writeJson(fileFor(dirs.sessions, code), item);
      return json(res, 201, { code, expires: item.expires, classCode });
    }

    const code = normalizeCode(parts[1]);
    if (!code || parts.length !== 2) return fail(res, 404, 'unknownSession');
    const item = loadSession(code);
    if (!item) return fail(res, 404, 'unknownSession');

    if (method === 'GET') return json(res, 200, { code, expires: item.expires, classCode: item.classCode, project: item.project });
    if (method === 'PUT') {
      const body = await readBody(req);
      if (!validProject(body.project)) return fail(res, 400, 'invalidProject');
      const now = Date.now();
      // Die Frist läuft ab der letzten Änderung (Arbeit geht nicht mitten in der Lektion verloren).
      const next = { ...item, project: body.project, updated: now, expires: now + ttl };
      writeJson(fileFor(dirs.sessions, code), next);
      return json(res, 200, { code, expires: next.expires });
    }
    if (method === 'DELETE') {
      remove(fileFor(dirs.sessions, code));
      return json(res, 200, { deleted: true });
    }
    return fail(res, 405, 'methodNotAllowed');
  }

  // --- Klassen beitreten ---
  if (parts[0] === 'classes' && parts[1] === 'join' && method === 'POST') {
    if (limited(req, 'join', 30)) return fail(res, 429, 'rateLimited');
    const body = await readBody(req);
    const code = normalizeCode(body.classCode);
    const item = code && loadClass(code);
    if (!item) return fail(res, 404, 'unknownClass');
    return json(res, 200, { classCode: code, label: item.label });
  }

  // --- Rückmeldungen ---
  if (parts[0] === 'feedback' && parts.length === 1 && method === 'POST') {
    if (limited(req, 'feedback', 5)) return fail(res, 429, 'rateLimited');
    const s = settings();
    if (!s.feedbackEnabled) return fail(res, 403, 'feedbackDisabled');
    const body = await readBody(req);
    const kind = ['problem', 'idea', 'other'].includes(body.kind) ? body.kind : 'other';
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_FEEDBACK_TEXT) : '';
    if (!text) return fail(res, 400, 'emptyText');
    const id = crypto.randomUUID();
    const now = Date.now();
    const item = {
      id,
      kind,
      text,
      created: now,
      expires: now + s.feedbackDays * 86_400_000,
      status: 'open',
      // Nur technische Angaben, keine Personendaten.
      version: typeof body.version === 'string' ? body.version.slice(0, 20) : '',
      locale: typeof body.locale === 'string' ? body.locale.slice(0, 5) : '',
      project: validProject(body.project) ? body.project : null,
    };
    writeJson(fileFor(dirs.feedback, id), item);
    return json(res, 201, { ok: true });
  }

  // --- Admin ---
  if (parts[0] === 'admin') return admin(req, res, parts.slice(1), method);

  return fail(res, 404, 'notFound');
}

function list(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const now = Date.now();
  return names.map((n) => readJson(path.join(dir, n))).filter((item) => item && item.expires > now);
}

async function admin(req, res, parts, method) {
  if (parts[0] === 'login' && method === 'POST') {
    if (limited(req, 'login', 10)) return fail(res, 429, 'rateLimited');
    if (!ADMIN_PASSWORD) return fail(res, 403, 'adminDisabled');
    const body = await readBody(req);
    if (!checkPassword(body.password || '')) return fail(res, 401, 'wrongPassword');
    const token = crypto.randomBytes(32).toString('base64url');
    tokens.set(token, Date.now() + ADMIN_TOKEN_HOURS * 3_600_000);
    return json(res, 200, { token });
  }
  if (!isAdmin(req)) return fail(res, 401, 'notLoggedIn');

  if (parts[0] === 'logout' && method === 'POST') {
    tokens.delete((req.headers.authorization || '').slice(7));
    return json(res, 200, { ok: true });
  }

  if (parts[0] === 'overview' && method === 'GET') {
    const sessions = list(dirs.sessions);
    const feedback = list(dirs.feedback);
    return json(res, 200, {
      settings: settings(),
      sessions: sessions.length,
      classes: list(dirs.classes)
        .map((c) => ({ code: c.code, label: c.label, created: c.created, expires: c.expires, sessions: sessions.filter((s) => s.classCode === c.code).length }))
        .sort((a, b) => b.created - a.created),
      feedbackOpen: feedback.filter((f) => f.status === 'open').length,
      feedbackTotal: feedback.length,
    });
  }

  // Ergebnis der Release-Prüfungen (Datenschutz, Sicherheit, Lizenzen), erzeugt von scripts/release-checks.mjs.
  if (parts[0] === 'checks' && method === 'GET') {
    const report = readJson(CHECKS_FILE);
    return report ? json(res, 200, report) : fail(res, 404, 'noChecks');
  }

  if (parts[0] === 'settings' && method === 'PUT') {
    const body = await readBody(req);
    const current = settings();
    const int = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
    const modes = { ...current.modes };
    for (const m of ['design', 'simulation']) if (body.modes && typeof body.modes[m] === 'boolean') modes[m] = body.modes[m];
    if (!modes.design && !modes.simulation) modes.design = true;
    const maxLevel = int(body.maxLevel, 1, 5, current.maxLevel);
    const next = {
      modes,
      maxLevel,
      defaultLevel: Math.min(int(body.defaultLevel, 1, 5, current.defaultLevel), maxLevel),
      disabled: Array.isArray(body.disabled) ? [...new Set(body.disabled.filter((f) => typeof f === 'string' && FEATURE_ID.test(f)))].slice(0, 200) : current.disabled,
      sessionHours: int(body.sessionHours, 1, 24 * 30, current.sessionHours),
      feedbackEnabled: typeof body.feedbackEnabled === 'boolean' ? body.feedbackEnabled : current.feedbackEnabled,
      feedbackDays: int(body.feedbackDays, 1, 365, current.feedbackDays),
      classHours: int(body.classHours, 1, 24 * 180, current.classHours),
    };
    writeJson(path.join(DATA_DIR, 'settings.json'), next);
    return json(res, 200, next);
  }

  if (parts[0] === 'feedback') {
    if (parts.length === 1 && method === 'GET') {
      return json(res, 200, list(dirs.feedback).sort((a, b) => b.created - a.created).map(({ project, ...f }) => ({ ...f, hasProject: !!project })));
    }
    const id = /^[0-9a-f-]{36}$/.test(parts[1] || '') ? parts[1] : null;
    const item = id && readJson(fileFor(dirs.feedback, id));
    if (!item) return fail(res, 404, 'notFound');
    if (method === 'GET') return json(res, 200, item);
    if (method === 'PATCH') {
      const body = await readBody(req);
      if (body.status === 'open' || body.status === 'done') writeJson(fileFor(dirs.feedback, id), { ...item, status: body.status });
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      remove(fileFor(dirs.feedback, id));
      return json(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'classes') {
    if (parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 40) : '';
      if (!label) return fail(res, 400, 'labelRequired');
      const s = settings();
      let code = newCode();
      while (fs.existsSync(fileFor(dirs.classes, code))) code = newCode();
      const now = Date.now();
      const item = { code, label, created: now, expires: now + s.classHours * 3_600_000 };
      writeJson(fileFor(dirs.classes, code), item);
      return json(res, 201, item);
    }
    const code = normalizeCode(parts[1]);
    const item = code && loadClass(code);
    if (!item) return fail(res, 404, 'unknownClass');
    if (parts[2] === 'sessions' && method === 'GET') {
      const sessions = list(dirs.sessions)
        .filter((s) => s.classCode === code)
        .sort((a, b) => a.created - b.created)
        .map((s) => ({ code: s.code, created: s.created, updated: s.updated, expires: s.expires, ...summary(s.project) }));
      return json(res, 200, sessions);
    }
    if (parts.length === 2 && method === 'DELETE') {
      // Klasse schliessen: auch alle ihre Sessions löschen.
      for (const s of list(dirs.sessions)) if (s.classCode === code) remove(fileFor(dirs.sessions, s.code));
      remove(fileFor(dirs.classes, code));
      return json(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'sessions') {
    if (parts.length === 1 && method === 'DELETE') {
      for (const s of list(dirs.sessions)) remove(fileFor(dirs.sessions, s.code));
      return json(res, 200, { ok: true });
    }
    const code = normalizeCode(parts[1]);
    const item = code && loadSession(code);
    if (!item) return fail(res, 404, 'unknownSession');
    if (method === 'GET') return json(res, 200, { code, project: item.project, classCode: item.classCode });
    if (method === 'DELETE') {
      remove(fileFor(dirs.sessions, code));
      return json(res, 200, { ok: true });
    }
  }

  return fail(res, 404, 'notFound');
}

// --- Server ------------------------------------------------------------------------

function createServer() {
  ensureDirs();
  cleanup();
  const timer = setInterval(cleanup, 10 * 60_000);
  timer.unref();

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      return fail(res, 400, 'badRequest');
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        // Nur JSON von der eigenen Seite (Schutz gegen fremde Formulare).
        const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
        if (hasBody && !(req.headers['content-type'] || '').startsWith('application/json')) {
          return fail(res, 415, 'jsonOnly');
        }
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'methodNotAllowed');
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return send(res, 200, req.method === 'HEAD' ? '' : html(), { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
      }
      const asset = url.pathname.startsWith('/assets/') ? bundle().assets.get(url.pathname) : undefined;
      if (asset) return send(res, 200, req.method === 'HEAD' ? '' : asset.body, { 'Content-Type': asset.type });
      if (url.pathname === '/THIRD_PARTY_NOTICES.md') {
        return send(res, 200, fs.readFileSync(NOTICES_FILE), { 'Content-Type': 'text/markdown; charset=utf-8' });
      }
      if (url.pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
      return fail(res, 404, 'notFound');
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      // Keine Anfragedaten ins Log: nur der Fehlercode.
      if (status === 500) console.error('Serverfehler:', error && error.message);
      return fail(res, status, error && error.status ? error.message : 'serverError');
    }
  });
}

module.exports = { createServer, normalizeCode, newCode, cleanup, DATA_DIR, ADMIN_PASSWORD };
