import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../sim/simulation';
import { parseProject } from './project';

const dir = join(__dirname, '../../../docs/beispiele');
const load = (name: string) => {
  const result = parseProject(readFileSync(join(dir, name), 'utf8'));
  if (!result.ok) throw new Error(`${name}: ${result.error.code} ${JSON.stringify(result.error.params)}`);
  return result.topology;
};

describe('Beispielprojekte', () => {
  it.each(readdirSync(dir).filter((f) => f.endsWith('.json')))('%s ist gültig', (name) => {
    expect(load(name).devices.length).toBeGreaterThan(0);
  });

  it('zwei-subnetze.json: PC 1 erreicht PC 2 über den Router', () => {
    const sim = new Simulation(load('zwei-subnetze.json'));
    sim.ping('d1', '192.168.2.10');
    sim.runUntilIdle();
    const codes = sim.getDeviceState('d1').console.map((l) => l.code);
    expect(codes.filter((c) => c === 'ping.reply')).toHaveLength(4);
  });

  it('web.json: Notebook bezieht per DHCP eine Adresse und ruft www.schule.example über den Router ab', () => {
    const sim = new Simulation(load('web.json'));
    sim.runUntil(2000);
    sim.browse('d1', 'http://www.schule.example/stundenplan.html');
    sim.runUntil(4000);
    expect(sim.getDeviceState('d1').browser).toMatchObject({ status: 'done', response: { status: 200 } });
    expect(sim.getDeviceState('d1').browser?.response?.body).toContain('Stundenplan');
  });

  it('mail.json: Anna schreibt Ben, Ben holt per IMAP ab', () => {
    const sim = new Simulation(load('mail.json'));
    sim.sendMail('d3', { to: ['ben@schule.example'], subject: 'Hallo', body: 'Test' });
    sim.runUntil(2000);
    sim.fetchMail('d4');
    sim.runUntil(4000);
    expect(sim.getDeviceState('d4').mail?.inbox).toMatchObject([{ from: 'anna@schule.example', subject: 'Hallo' }]);
  });

  it('heimnetz-nat.json: PC erreicht das Internet über NAT, Aussen erreicht das NAS über die Weiterleitung', () => {
    const sim = new Simulation(load('heimnetz-nat.json'));
    sim.browse('d1', 'http://198.51.100.10/');
    sim.browse('d8', 'http://203.0.113.2/');
    sim.runUntil(5000);
    expect(sim.getDeviceState('d1').browser?.response?.body).toContain('Öffentlicher Webserver');
    expect(sim.getDeviceState('d8').browser?.response?.body).toContain('NAS im Heimnetz');
  });

  it('vlan-stp.json: Ring ohne Sturm, VLANs über Trunks', () => {
    const sim = new Simulation(load('vlan-stp.json'));
    sim.runUntil(6000);
    sim.ping('d4', '10.0.10.12');
    sim.ping('d5', '10.0.20.12');
    sim.runUntil(14_000);
    for (const id of ['d4', 'd5']) {
      expect(sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply')).toHaveLength(4);
    }
    const blocked = ['d1', 'd2', 'd3'].flatMap((id) => sim.getDeviceState(id).stp?.ports.filter((p) => p.state === 'blocking') ?? []);
    expect(blocked).toHaveLength(1);
  });

  it('dhcp.json: alle drei Clients erhalten eine Adresse', () => {
    const sim = new Simulation(load('dhcp.json'));
    sim.runUntil(10_000);
    expect(['d3', 'd4', 'd5'].map((id) => sim.getDeviceState(id).address?.ip)).toEqual([
      '192.168.10.100',
      '192.168.10.101',
      '192.168.10.102',
    ]);
  });

  const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply').length;
  const byName = (t: ReturnType<typeof load>, name: string) => t.devices.find((d) => d.name === name)!.id;

  it('router-on-a-stick.json: Verwaltung erreicht Unterricht über die Subinterfaces', () => {
    const t = load('router-on-a-stick.json');
    const sim = new Simulation(t);
    sim.ping(byName(t, 'PC Verwaltung'), '192.168.20.11');
    sim.runUntilIdle();
    expect(replies(sim, byName(t, 'PC Verwaltung'))).toBe(4);
  });

  it('layer3-switch.json: Notebooks beziehen über das DHCP-Relay der SVIs Adressen aus ihrem VLAN', () => {
    const t = load('layer3-switch.json');
    const sim = new Simulation(t);
    sim.runUntil(5000);
    expect(sim.getDeviceState(byName(t, 'Notebook 1')).address?.ip).toMatch(/^10\.10\.0\./);
    expect(sim.getDeviceState(byName(t, 'Notebook 2')).address?.ip).toMatch(/^10\.20\.0\./);
    sim.ping(byName(t, 'Notebook 1'), '10.99.0.10');
    sim.runUntil(15000);
    expect(replies(sim, byName(t, 'Notebook 1'))).toBe(4);
  });

  it('wlan-mesh.json: Notebook im OG erreicht den Server über das Mesh', () => {
    const t = load('wlan-mesh.json');
    const sim = new Simulation(t);
    sim.ping(byName(t, 'Notebook OG'), '192.168.50.5');
    sim.runUntilIdle();
    expect(replies(sim, byName(t, 'Notebook OG'))).toBe(4);
  });
});
