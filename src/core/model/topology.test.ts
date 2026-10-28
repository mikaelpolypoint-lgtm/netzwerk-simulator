import { describe, expect, it } from 'vitest';
import { macFor } from './mac';
import {
  addDevice,
  cablesOf,
  connect,
  emptyTopology,
  getDevice,
  moveDevice,
  removeCable,
  removeDevice,
  renameDevice,
  setInterfaceCount,
  suggestName,
  type Result,
} from './topology';
import type { DeviceType, Topology } from './types';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`Unerwarteter Fehler: ${r.error.code}`);
  return r.value;
}

function add(t: Topology, type: DeviceType, name: string) {
  return unwrap(addDevice(t, type, name, { x: 0, y: 0 }));
}

describe('Geräte', () => {
  it('vergibt fortlaufende IDs und Ports gemäss Gerätetyp', () => {
    let t = emptyTopology();
    const pc = add(t, 'pc', 'PC 1');
    t = pc.topology;
    const sw = add(t, 'switch', 'Switch 1');
    t = sw.topology;

    expect(pc.id).toBe('d1');
    expect(sw.id).toBe('d2');
    expect(getDevice(t, 'd1')!.interfaces).toHaveLength(1);
    expect(getDevice(t, 'd2')!.interfaces).toHaveLength(8);
  });

  it('erzeugt deterministische, eindeutige MAC-Adressen', () => {
    expect(macFor(1, 0)).toBe('02:00:00:00:01:00');
    expect(macFor(300, 7)).toBe('02:00:00:01:2C:07');

    let t = emptyTopology();
    t = add(t, 'switch', 'S1').topology;
    t = add(t, 'router', 'R1').topology;
    const macs = t.devices.flatMap((d) => d.interfaces.map((i) => i.mac));
    expect(new Set(macs).size).toBe(macs.length);
  });

  it('lehnt leere, zu lange und doppelte Namen ab', () => {
    const t = add(emptyTopology(), 'pc', 'Server').topology;
    expect(addDevice(t, 'pc', '  ', { x: 0, y: 0 })).toMatchObject({ ok: false, error: { code: 'nameEmpty' } });
    expect(addDevice(t, 'pc', 'x'.repeat(33), { x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'nameTooLong' },
    });
    expect(addDevice(t, 'pc', 'server', { x: 0, y: 0 })).toMatchObject({ ok: false, error: { code: 'nameTaken' } });
  });

  it('benennt um und erlaubt dabei den eigenen Namen', () => {
    const t = add(emptyTopology(), 'pc', 'PC 1').topology;
    expect(renameDevice(t, 'd1', 'PC 1')).toEqual({ ok: true, value: t });
    const renamed = unwrap(renameDevice(t, 'd1', '  Webserver '));
    expect(getDevice(renamed, 'd1')!.name).toBe('Webserver');
  });

  it('schlägt freie Namen vor', () => {
    let t = add(emptyTopology(), 'pc', 'PC 1').topology;
    t = add(t, 'pc', 'PC 3').topology;
    expect(suggestName(t, 'PC')).toBe('PC 2');
  });

  it('verschiebt ohne das Original zu verändern', () => {
    const t = add(emptyTopology(), 'pc', 'PC 1').topology;
    const moved = unwrap(moveDevice(t, 'd1', { x: 40, y: 20 }));
    expect(getDevice(moved, 'd1')!.position).toEqual({ x: 40, y: 20 });
    expect(getDevice(t, 'd1')!.position).toEqual({ x: 0, y: 0 });
  });
});

describe('Kabel', () => {
  function twoClientsOneSwitch() {
    let t = emptyTopology();
    t = add(t, 'notebook', 'Client 1').topology;
    t = add(t, 'notebook', 'Client 2').topology;
    t = add(t, 'switch', 'Switch 1').topology;
    t = unwrap(connect(t, 'd1', 'd3')).topology;
    t = unwrap(connect(t, 'd2', 'd3')).topology;
    return t;
  }

  it('belegt jeweils den ersten freien Port', () => {
    const t = twoClientsOneSwitch();
    expect(t.cables).toEqual([
      { id: 'c4', a: { device: 'd1', iface: 0 }, b: { device: 'd3', iface: 0 } },
      { id: 'c5', a: { device: 'd2', iface: 0 }, b: { device: 'd3', iface: 1 } },
    ]);
  });

  it('meldet, wenn ein Gerät keinen freien Anschluss mehr hat', () => {
    let t = twoClientsOneSwitch();
    t = add(t, 'switch', 'Switch 2').topology;
    expect(connect(t, 'd1', 'd6')).toMatchObject({
      ok: false,
      error: { code: 'noFreeInterface', params: { device: 'Client 1' } },
    });
  });

  it('verhindert Kabel zu sich selbst und doppelte Direktverbindungen', () => {
    const t = twoClientsOneSwitch();
    expect(connect(t, 'd3', 'd3')).toMatchObject({ ok: false, error: { code: 'sameDevice' } });
    expect(connect(t, 'd3', 'd1')).toMatchObject({ ok: false, error: { code: 'alreadyConnected' } });
  });

  it('entfernt beim Löschen eines Geräts dessen Kabel', () => {
    const t = unwrap(removeDevice(twoClientsOneSwitch(), 'd3'));
    expect(t.devices.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(t.cables).toEqual([]);
  });

  it('gibt nach dem Entfernen eines Kabels den Port wieder frei', () => {
    let t = unwrap(removeCable(twoClientsOneSwitch(), 'c4'));
    t = add(t, 'pc', 'PC 1').topology;
    const { topology } = unwrap(connect(t, 'd6', 'd3'));
    expect(cablesOf(topology, 'd6')[0]!.b).toEqual({ device: 'd3', iface: 0 });
  });
});

describe('Anzahl Ports', () => {
  it('erweitert mit passenden MAC-Adressen', () => {
    const t = add(emptyTopology(), 'router', 'R1').topology;
    const more = unwrap(setInterfaceCount(t, 'd1', 3));
    expect(getDevice(more, 'd1')!.interfaces.map((i) => i.mac)).toEqual([macFor(1, 0), macFor(1, 1), macFor(1, 2)]);
  });

  it('entfernt keine belegten Ports und hält die Grenzen ein', () => {
    let t = add(emptyTopology(), 'switch', 'S1').topology;
    t = add(t, 'pc', 'PC 1').topology;
    t = add(t, 'pc', 'PC 2').topology;
    t = add(t, 'pc', 'PC 3').topology;
    for (const pc of ['d2', 'd3', 'd4']) t = unwrap(connect(t, pc, 'd1')).topology;

    expect(setInterfaceCount(t, 'd1', 2)).toMatchObject({ ok: false, error: { code: 'interfaceConnected' } });
    expect(setInterfaceCount(t, 'd1', 1)).toMatchObject({ ok: false, error: { code: 'interfaceCountOutOfRange' } });
    expect(getDevice(unwrap(setInterfaceCount(t, 'd1', 3)), 'd1')!.interfaces).toHaveLength(3);
  });
});
