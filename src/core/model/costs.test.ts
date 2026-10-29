import { describe, expect, it } from 'vitest';
import { PRICES, convert, costOf, devicePrice } from './costs';
import { addDevice, connect, emptyTopology, getDevice, insertSfpModule } from './topology';
import type { Result } from './topology';

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};

describe('Kostenmodell', () => {
  it('rechnet Geräte, Kabel und Module zusammen', () => {
    let t = emptyTopology();
    const pc = ok(addDevice(t, 'pc', 'PC', { x: 0, y: 0 }));
    t = pc.topology;
    const sw = ok(addDevice(t, 'switch', 'S1', { x: 100, y: 0 }, { ports: 8, sfpSlots: 2 }));
    t = sw.topology;
    t = ok(connect(t, pc.id, sw.id)).topology;
    t = ok(insertSfpModule(t, sw.id, '1G-SX')).topology;

    const switchPrice = PRICES.switchBase + 8 * PRICES.switchPort + 2 * PRICES.switchSfp;
    expect(devicePrice(getDevice(t, sw.id)!)).toBe(switchPrice);
    const summary = costOf(t);
    expect(summary.total).toBe(PRICES.pc + switchPrice + PRICES.cable.tp + PRICES.sfp['1G-SX']);
    expect(summary.lines.map((l) => l.key)).toEqual(['pc', 'switch', 'sfp:1G-SX', 'cable:tp']);
  });

  it('zählt Client-Gruppen pro Gerät und das Internet gratis', () => {
    let t = emptyTopology();
    t = ok(addDevice(t, 'clientgroup', 'Klasse', { x: 0, y: 0 }, { groupSize: 25 })).topology;
    t = ok(addDevice(t, 'internet', 'Internet', { x: 100, y: 0 })).topology;
    const summary = costOf(t);
    expect(summary.lines).toEqual([{ key: 'clientgroup', count: 25, total: 25 * PRICES.groupMember }]);
  });

  it('rechnet Währungen mit festen Kursen um', () => {
    expect(convert(1000, 'CHF')).toBe(1000);
    expect(convert(1000, 'EUR')).toBe(1050);
    expect(convert(1000, 'USD')).toBe(1200);
  });
});
