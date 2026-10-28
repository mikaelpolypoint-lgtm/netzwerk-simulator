import { describe, expect, it } from 'vitest';
import { addDevice, connect, emptyTopology, type Result } from '../model/topology';
import type { DeviceType, Topology } from '../model/types';
import { FORMAT_VERSION, parseProject, serializeProject } from './project';

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

/** Abnahmekriterium M1: 2 Clients, 1 Switch. */
function sampleNetwork(): Topology {
  let t = emptyTopology();
  const place = (type: DeviceType, name: string, x: number, y: number) => {
    t = unwrap(addDevice(t, type, name, { x, y })).topology;
  };
  place('notebook', 'Client 1', 0, 0);
  place('notebook', 'Client 2', 200, 0);
  place('switch', 'Switch 1', 100, 150);
  t = unwrap(connect(t, 'd1', 'd3')).topology;
  t = unwrap(connect(t, 'd2', 'd3')).topology;
  return t;
}

function fileWith(change: (file: any) => void): string {
  const file = JSON.parse(serializeProject(sampleNetwork()));
  change(file);
  return JSON.stringify(file);
}

describe('Projektdatei', () => {
  it('lässt sich speichern und unverändert wieder laden', () => {
    const t = sampleNetwork();
    const text = serializeProject(t);
    expect(JSON.parse(text).meta).toEqual({ format: 'netzwerk-simulator', version: FORMAT_VERSION });
    expect(parseProject(text)).toEqual({ ok: true, topology: t });
  });

  it('erkennt kaputtes JSON und fremde Dateien', () => {
    expect(parseProject('{nicht json')).toMatchObject({ ok: false, error: { code: 'invalidJson' } });
    expect(parseProject('{"hello": 1}')).toMatchObject({ ok: false, error: { code: 'notAProject' } });
  });

  it('lehnt Dateien aus neueren Versionen ab', () => {
    const text = fileWith((f) => (f.meta.version = FORMAT_VERSION + 1));
    expect(parseProject(text)).toMatchObject({ ok: false, error: { code: 'unsupportedVersion' } });
  });

  it('nennt die fehlerhafte Stelle', () => {
    const cases: [(f: any) => void, string][] = [
      [(f) => (f.topology.devices[1].type = 'toaster'), 'topology.devices[1].type'],
      [(f) => (f.topology.devices[1].name = 'client 1'), 'topology.devices[1].name'],
      [(f) => (f.topology.devices[0].interfaces[0].mac = 'xx'), 'topology.devices[0].interfaces[0].mac'],
      [(f) => (f.topology.devices[2].interfaces = []), 'topology.devices[2].interfaces'],
      [(f) => (f.topology.cables[0].b.device = 'd99'), 'topology.cables[0].b.device'],
      [(f) => (f.topology.cables[1].b.iface = 0), 'topology.cables[1].b.iface'],
      [(f) => (f.topology.cables[0].b = f.topology.cables[0].a), 'topology.cables[0].b.iface'],
    ];
    for (const [change, path] of cases) {
      expect(parseProject(fileWith(change))).toEqual({ ok: false, error: { code: 'invalidStructure', params: { path } } });
    }
  });

  it('übernimmt nur bekannte Felder', () => {
    const text = fileWith((f) => {
      f.topology.devices[0].script = 'alert(1)';
      f.extra = true;
    });
    const result = parseProject(text);
    expect(result.ok && 'script' in result.topology.devices[0]!).toBe(false);
  });

  it('stellt eine zu kleine nextId richtig', () => {
    const result = parseProject(fileWith((f) => (f.topology.nextId = 2)));
    expect(result.ok && result.topology.nextId).toBe(6);
  });
});
