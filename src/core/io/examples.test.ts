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

  it('web.json: Notebook bezieht per DHCP eine Adresse und ruft www.schule.ch über den Router ab', () => {
    const sim = new Simulation(load('web.json'));
    sim.runUntil(2000);
    sim.browse('d1', 'http://www.schule.ch/stundenplan.html');
    sim.runUntil(4000);
    expect(sim.getDeviceState('d1').browser).toMatchObject({ status: 'done', response: { status: 200 } });
    expect(sim.getDeviceState('d1').browser?.response?.body).toContain('Stundenplan');
  });

  it('mail.json: Anna schreibt Ben, Ben holt per IMAP ab', () => {
    const sim = new Simulation(load('mail.json'));
    sim.sendMail('d3', { to: ['ben@schule.ch'], subject: 'Hallo', body: 'Test' });
    sim.runUntil(2000);
    sim.fetchMail('d4');
    sim.runUntil(4000);
    expect(sim.getDeviceState('d4').mail?.inbox).toMatchObject([{ from: 'anna@schule.ch', subject: 'Hallo' }]);
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
});
