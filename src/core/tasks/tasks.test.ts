import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../io/project';
import { Simulation } from '../sim/simulation';
import { NetBuilder } from '../sim/testing';
import { evaluateGoal, evaluateTasks, type TaskSet } from './tasks';

const load = (name: string) => {
  const result = parseProject(readFileSync(join(__dirname, '../../../docs/aufgaben', name), 'utf8'));
  if (!result.ok || !result.tasks) throw new Error(`${name} hat keine Aufgaben`);
  return { topology: result.topology, tasks: result.tasks };
};

const passed = (results: { id: string; passed: boolean }[]) => results.filter((r) => r.passed).map((r) => r.id);

describe('Musteraufgabe "Netz mit zwei Subnetzen aufbauen" (Abnahme M6)', () => {
  it('ist im Startzustand nicht erfüllt', () => {
    const { topology, tasks } = load('zwei-subnetze.json');
    const results = evaluateTasks(topology, tasks);
    expect(passed(results)).toEqual([]);
    expect(results.find((r) => r.id === 'kabel-pc1')?.reason).toEqual({ code: 'notConnected', params: { a: 'PC 1', b: 'Router 1' } });
    expect(results.find((r) => r.id === 'netz-pc1')?.reason?.code).toBe('noAddress');
  });

  it('ist mit der Lösung erfüllt, bis auf den selbst gesendeten Ping', () => {
    const { topology, tasks } = load('zwei-subnetze-loesung.json');
    const results = evaluateTasks(topology, tasks);
    expect(passed(results)).toEqual(['kabel-pc1', 'kabel-pc2', 'netz-pc1', 'netz-pc2', 'verschieden', 'gw-pc1', 'gw-pc2', 'ping']);
    expect(results.find((r) => r.id === 'selbst-gepingt')?.reason?.code).toBe('packetNotSeen');

    // Hat die Lernende selbst gepingt, ist auch das letzte Ziel erfüllt.
    const live = new Simulation(topology);
    live.ping('d1', '192.168.2.10');
    live.runUntilIdle();
    expect(evaluateTasks(topology, tasks, live.getPacketLog()).every((r) => r.passed)).toBe(true);
  });

  it('erkennt typische Fehler: falsches Netz und fehlendes Gateway', () => {
    const { topology, tasks } = load('zwei-subnetze-loesung.json');
    const broken = {
      ...topology,
      devices: topology.devices.map((d) => {
        if (d.name === 'PC 2') {
          const { gateway: _g, ...rest } = d;
          return { ...rest, interfaces: [{ ...d.interfaces[0]!, ip: '192.168.1.20' }] };
        }
        return d;
      }),
    };
    const results = evaluateTasks(broken, tasks);
    expect(results.find((r) => r.id === 'netz-pc2')?.reason).toMatchObject({
      code: 'wrongNetwork',
      params: { actual: '192.168.1.0/24', expected: '192.168.2.0/24' },
    });
    expect(results.find((r) => r.id === 'gw-pc2')?.reason?.code).toBe('noGateway');
    expect(results.find((r) => r.id === 'verschieden')?.passed).toBe(false);
    expect(results.find((r) => r.id === 'ping')?.passed).toBe(false);
  });

  it('bleibt beim Speichern und Laden erhalten', () => {
    const { topology, tasks } = load('zwei-subnetze.json');
    expect(parseProject(serializeProject(topology, tasks))).toEqual({ ok: true, topology, tasks });
  });
});

describe('Prüfbausteine', () => {
  const goal = (check: TaskSet['goals'][number]['check']) => ({ id: 'x', text: 'x', check });

  it('findet Geräte unabhängig von Gross-/Kleinschreibung und meldet fehlende', () => {
    const net = new NetBuilder();
    net.host('Server', '10.0.0.1');
    expect(evaluateGoal(net.topology, goal({ type: 'inNetwork', device: 'server', network: '10.0.0.0/24' })).passed).toBe(true);
    expect(evaluateGoal(net.topology, goal({ type: 'gateway', device: 'Client' })).reason).toEqual({
      code: 'deviceMissing',
      params: { name: 'Client' },
    });
  });

  it('zählt Geräte', () => {
    const net = new NetBuilder();
    net.add('switch', 'S1');
    net.host('A', '10.0.0.1');
    expect(evaluateGoal(net.topology, goal({ type: 'deviceCount', deviceType: 'switch', min: 1 })).passed).toBe(true);
    expect(evaluateGoal(net.topology, goal({ type: 'deviceCount', min: 3 })).reason?.code).toBe('tooFewDevices');
  });

  it('prüft DHCP, Webseiten und E-Mail in einer eigenen Simulation', () => {
    const net = new NetBuilder();
    const server = net.host('Server', '192.168.0.2');
    net.dhcpServer(server, { start: '192.168.0.100', end: '192.168.0.110', dns: '192.168.0.2', leaseTime: 600 });
    net.dnsRecord(server, 'www', 'A', '192.168.0.2');
    net.dnsRecord(server, 'mail', 'A', '192.168.0.2');
    net.webServer(server, { '/index.html': 'hallo' });
    net.mailServer(server, 'schule.ch', ['anna', 'ben']);
    const client = net.dhcpClient('Notebook');
    net.mailAccount(client, 'anna@schule.ch', 'mail');
    net.link(server, client);
    const t = net.topology;
    expect(evaluateGoal(t, goal({ type: 'dhcpLease', device: 'Notebook' })).passed).toBe(true);
    expect(evaluateGoal(t, goal({ type: 'http', from: 'Notebook', url: 'http://www/' })).passed).toBe(true);
    expect(evaluateGoal(t, goal({ type: 'http', from: 'Notebook', url: 'http://www/fehlt.html', status: 404 })).passed).toBe(true);
    expect(evaluateGoal(t, goal({ type: 'mail', from: 'Notebook', to: 'ben@schule.ch' })).passed).toBe(true);
    expect(evaluateGoal(t, goal({ type: 'mail', from: 'Notebook', to: 'niemand@schule.ch' })).passed).toBe(false);
    expect(evaluateGoal(t, goal({ type: 'ping', from: 'Server', to: 'Notebook' })).passed).toBe(true);
  });

  it('lehnt Aufgabendateien mit unbekannten Prüfungen ab', () => {
    const { topology, tasks } = load('zwei-subnetze.json');
    const file = JSON.parse(serializeProject(topology, tasks));
    file.tasks.goals[0].check = { type: 'eval', code: 'alert(1)' };
    expect(parseProject(JSON.stringify(file))).toEqual({
      ok: false,
      error: { code: 'invalidStructure', params: { path: 'tasks.goals[0].check.type' } },
    });
  });
});
