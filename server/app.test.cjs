'use strict';
// Tests der Server-API: npm run test:server
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-data-'));
process.env.DATA_DIR = dataDir;
process.env.ADMIN_PASSWORD = 'test-admin-passwort';
const { createServer, normalizeCode } = require('./app.cjs');

let server;
let base;
const project = (n = 1) => ({ meta: { format: 'netzwerk-simulator', version: 1 }, topology: { devices: Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}` })), cables: [], nextId: n + 1 }, configuration: {} });

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('liefert die App mit Server-Kennung und CSP für die eigene API', async () => {
  const res = await call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.data, /<meta name="ns-server" content="1"/);
  assert.match(res.data, /connect-src 'self'/);
  assert.doesNotMatch(res.data, /connect-src 'none'/);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('Codes: normalisiert und ohne verwechselbare Zeichen', () => {
  assert.equal(normalizeCode('k7f2 9qxm'), 'K7F2-9QXM');
  assert.equal(normalizeCode('K7F2-9QX0'), null);
  assert.equal(normalizeCode('../etc'), null);
});

test('Session anlegen, laden, ändern, löschen', async () => {
  const created = await call('POST', '/api/sessions', { project: project(2) });
  assert.equal(created.status, 201);
  const { code } = created.data;
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const loaded = await call('GET', `/api/sessions/${code.toLowerCase().replace('-', '')}`);
  assert.equal(loaded.data.project.topology.devices.length, 2);
  const updated = await call('PUT', `/api/sessions/${code}`, { project: project(3) });
  assert.equal(updated.status, 200);
  assert.equal((await call('GET', `/api/sessions/${code}`)).data.project.topology.devices.length, 3);
  assert.equal((await call('DELETE', `/api/sessions/${code}`)).status, 200);
  assert.equal((await call('GET', `/api/sessions/${code}`)).status, 404);
});

test('nimmt nur Projekte des Simulators an', async () => {
  assert.equal((await call('POST', '/api/sessions', { project: { name: 'Max Muster' } })).status, 400);
});

test('speichert keine IP-Adressen', async () => {
  await call('POST', '/api/sessions', { project: project() });
  await call('POST', '/api/feedback', { kind: 'idea', text: 'Mehr Aufgaben' });
  const all = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else all.push(fs.readFileSync(file, 'utf8'));
    }
  };
  walk(dataDir);
  assert.ok(all.length > 0);
  for (const content of all) assert.doesNotMatch(content, /127\.0\.0\.1|::ffff/);
});

test('Admin: Anmeldung, Einstellungen, Klassen, Rückmeldungen', async () => {
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'falsch' })).status, 401);
  const { token } = (await call('POST', '/api/admin/login', { password: 'test-admin-passwort' })).data;
  assert.ok(token);

  const saved = await call('PUT', '/api/admin/settings', { modes: { simulation: false }, maxLevel: 3, defaultLevel: 4, disabled: ['routing.bgp', 'kein gültiger Name'], sessionHours: 48 }, token);
  assert.equal(saved.data.sessionHours, 48);
  const config = (await call('GET', '/api/config')).data;
  assert.deepEqual(config.policy, { modes: { design: true, simulation: false }, maxLevel: 3, defaultLevel: 3, disabled: ['routing.bgp'], sessionHours: 48 });
  // Release-Prüfungen: ohne Bericht 404, sonst JSON.
  assert.ok([200, 404].includes((await call('GET', '/api/admin/checks', null, token)).status));

  const cls = (await call('POST', '/api/admin/classes', { label: 'INF22a' }, token)).data;
  assert.equal((await call('POST', '/api/classes/join', { classCode: cls.code })).data.label, 'INF22a');
  const s1 = (await call('POST', '/api/sessions', { project: project(4), classCode: cls.code })).data;
  assert.equal(s1.classCode, cls.code);
  const sessions = (await call('GET', `/api/admin/classes/${cls.code}/sessions`, null, token)).data;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].devices, 4);
  assert.equal((await call('GET', `/api/admin/sessions/${s1.code}`, null, token)).data.project.topology.devices.length, 4);

  // Klasse schliessen löscht auch ihre Sessions.
  await call('DELETE', `/api/admin/classes/${cls.code}`, null, token);
  assert.equal((await call('GET', `/api/sessions/${s1.code}`)).status, 404);

  const feedback = (await call('GET', '/api/admin/feedback', null, token)).data;
  assert.ok(feedback.some((f) => f.text === 'Mehr Aufgaben' && f.status === 'open'));
  const id = feedback[0].id;
  await call('PATCH', `/api/admin/feedback/${id}`, { status: 'done' }, token);
  assert.equal((await call('GET', `/api/admin/feedback/${id}`, null, token)).data.status, 'done');
});

test('lehnt Formular-Posts ohne JSON ab', async () => {
  const res = await fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'text=x' });
  assert.equal(res.status, 415);
});
