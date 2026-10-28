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
});
