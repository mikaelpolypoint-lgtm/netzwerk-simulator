import { describe, expect, it } from 'vitest';
import {
  Simulation,
  addDevice,
  addDnsRecord,
  addStaticNat,
  addStaticRoute,
  setBgp,
  setEncapsulation,
  setOspf,
  setPortSerial,
  setRip,
  setInterfaceShutdown,
  setStp,
  setVlanDef,
  type PacketLogEntry,
  configureHost,
  connect,
  evaluateTasks,
  getDevice,
  insertSfpModule,
  parseProject,
  serializeProject,
  setDhcpServer,
  setInterfaceAddress,
  setInterfaceNat,
  setInterfaceRelay,
  setPortTrunk,
  setPortVlan,
  setSubinterface,
  setSvi,
  setWifiClient,
  setWlan,
  type Result,
  type Topology,
} from '../core';
import { setLocale } from '../i18n';
import { CATALOG } from './catalog';

setLocale('de');

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

const byName = (t: Topology, name: string) => t.devices.find((d) => d.name === name)!.id;
const passed = (t: Topology, id: string, log: readonly PacketLogEntry[] = []) => {
  const entry = CATALOG.find((e) => e.id === id)!;
  const { tasks } = entry.build();
  return evaluateTasks(t, tasks, log);
};

/** Mitschnitt einer Simulation, für Aufgaben, die gesendete Pakete prüfen. */
const LOGS: Record<string, (t: Topology) => readonly PacketLogEntry[]> = {
  'sniff-arp': (t) => {
    const sim = new Simulation(t);
    sim.ping(byName(t, 'PC 1'), '192.168.1.20');
    sim.runUntil(10_000);
    return sim.getPacketLog();
  },
};

/** Musterlösungen: Jede Aufgabe muss lösbar sein. */
const SOLUTIONS: Record<string, (t: Topology) => Topology> = {
  'sniff-arp': (t) => t,
  'budget-office': (t) => {
    const added = unwrap(addDevice(t, 'switch', 'Switch', { x: 0, y: 0 }, { ports: 8, sfpSlots: 0 }));
    t = added.topology;
    for (const n of ['PC 1', 'PC 2', 'PC 3', 'PC 4']) t = unwrap(connect(t, byName(t, n), added.id)).topology;
    return t;
  },
  'server-group': (t) => {
    t = unwrap(connect(t, byName(t, 'Schulzimmer'), byName(t, 'Switch'))).topology;
    return unwrap(setDhcpServer(t, byName(t, 'Server'), { start: '192.168.10.100', end: '192.168.10.199', leaseTime: 3600 }));
  },
  'vlan-colors': (t) => {
    t = unwrap(setVlanDef(t, { id: 10, name: 'Büro', color: 'blue' }));
    return unwrap(setVlanDef(t, { id: 20, name: 'Labor', color: 'orange' }));
  },
  'stp-loop': (t) => {
    for (const n of ['Switch A', 'Switch B', 'Switch C']) t = unwrap(setStp(t, byName(t, n), true));
    return t;
  },
  'internet-nat': (t) => {
    const r = byName(t, 'Heimrouter');
    t = unwrap(setInterfaceNat(t, r, 1, true));
    return unwrap(addStaticRoute(t, r, { network: '0.0.0.0', mask: '0.0.0.0', gateway: '203.0.113.1' }));
  },
  'modem-vdsl': (t) => unwrap(connect(t, byName(t, 'Modem'), byName(t, 'Provider'), 'dsl')).topology,
  'serial-wan': (t) => {
    const zh = byName(t, 'R Zürich');
    const be = byName(t, 'R Bern');
    for (const [r, ip] of [[zh, '10.0.0.1'], [be, '10.0.0.2']] as const) {
      t = unwrap(setPortSerial(t, r, 1, true));
      t = unwrap(setEncapsulation(t, r, 1, 'ppp'));
      t = unwrap(setInterfaceAddress(t, r, 1, ip, '30'));
    }
    t = unwrap(connect(t, zh, be, 'serial')).topology;
    t = unwrap(addStaticRoute(t, zh, { network: '10.2.0.0', mask: '255.255.255.0', gateway: '10.0.0.2' }));
    return unwrap(addStaticRoute(t, be, { network: '10.1.0.0', mask: '255.255.255.0', gateway: '10.0.0.1' }));
  },
  'ospf-triangle': (t) => {
    for (const n of ['R1', 'R2', 'R3']) t = unwrap(setOspf(t, byName(t, n), { networks: [{ network: '0.0.0.0', mask: '0.0.0.0', area: 0 }] }));
    return t;
  },
  'port-shutdown': (t) => {
    const gast = byName(t, 'Gast');
    const cable = t.cables.find((c) => c.a.device === gast || c.b.device === gast)!;
    const end = cable.a.device === gast ? cable.b : cable.a;
    return unwrap(setInterfaceShutdown(t, end.device, end.iface, true));
  },
  'subnetting-vlsm': (t) => {
    const r = byName(t, 'Router');
    const plan = [
      ['Verwaltung', '192.168.10.1', '192.168.10.10', '25'],
      ['Labor', '192.168.10.129', '192.168.10.130', '26'],
      ['Gäste', '192.168.10.193', '192.168.10.194', '27'],
    ] as const;
    for (const [name, gw, ip, prefix] of plan) {
      const pc = byName(t, name);
      const cable = t.cables.find((c) => c.a.device === pc || c.b.device === pc)!;
      const port = cable.a.device === r ? cable.a.iface : cable.b.iface;
      t = unwrap(setInterfaceAddress(t, r, port, gw, prefix));
      t = unwrap(configureHost(t, pc, { ip, mask: prefix, gateway: gw }));
    }
    return t;
  },
  'fiber-ont': (t) => unwrap(connect(t, byName(t, 'ONT'), byName(t, 'Provider'), 'fiber')).topology,
  'rip-chain': (t) => {
    for (const n of ['R1', 'R2', 'R3']) t = unwrap(setRip(t, byName(t, n), { networks: [{ network: '0.0.0.0', mask: '0.0.0.0' }] }));
    return t;
  },
  'static-nat-dmz': (t) => unwrap(addStaticNat(t, byName(t, 'Firmenrouter'), { inside: '192.168.0.80', outside: '203.0.113.5' })),
  'bgp-two-as': (t) => {
    t = unwrap(setBgp(t, byName(t, 'R Firma'), { asn: 65001, neighbors: [{ ip: '172.16.12.2', remoteAs: 65002 }], networks: [{ network: '10.1.0.0', mask: '255.255.0.0' }] }));
    return unwrap(setBgp(t, byName(t, 'R Provider'), { asn: 65002, neighbors: [{ ip: '172.16.12.1', remoteAs: 65001 }], networks: [{ network: '10.2.0.0', mask: '255.255.0.0' }] }));
  },
  'two-pcs': (t) => {
    t = unwrap(connect(t, byName(t, 'PC 1'), byName(t, 'PC 2'))).topology;
    t = unwrap(configureHost(t, byName(t, 'PC 1'), { ip: '192.168.1.1', mask: '24' }));
    return unwrap(configureHost(t, byName(t, 'PC 2'), { ip: '192.168.1.2', mask: '24' }));
  },
  'switch-lan': (t) => {
    for (const [n, ip] of [['PC 1', '10.0.0.1'], ['PC 2', '10.0.0.2'], ['Notebook', '10.0.0.3']] as const) {
      t = unwrap(connect(t, byName(t, n), byName(t, 'Switch'))).topology;
      t = unwrap(configureHost(t, byName(t, n), { ip, mask: '24' }));
    }
    return t;
  },
  'two-subnets': (t) => {
    t = unwrap(connect(t, byName(t, 'PC 1'), byName(t, 'Router'))).topology;
    t = unwrap(connect(t, byName(t, 'Router'), byName(t, 'PC 2'))).topology;
    t = unwrap(setInterfaceAddress(t, byName(t, 'Router'), 0, '192.168.1.1', '24'));
    t = unwrap(setInterfaceAddress(t, byName(t, 'Router'), 1, '192.168.2.1', '24'));
    t = unwrap(configureHost(t, byName(t, 'PC 1'), { ip: '192.168.1.10', mask: '24', gateway: '192.168.1.1' }));
    return unwrap(configureHost(t, byName(t, 'PC 2'), { ip: '192.168.2.10', mask: '24', gateway: '192.168.2.1' }));
  },
  dhcp: (t) => {
    t = unwrap(setDhcpServer(t, byName(t, 'Server'), { start: '192.168.50.100', end: '192.168.50.120', leaseTime: 3600 }));
    for (const n of ['Notebook 1', 'Notebook 2', 'Notebook 3']) t = unwrap(configureHost(t, byName(t, n), { ip: '', mask: '', dhcp: true }));
    return t;
  },
  'web-dns': (t) => {
    t = unwrap(addDnsRecord(t, byName(t, 'DNS-Server'), { name: 'www.schule.ch', type: 'A', value: '10.1.1.80', ttl: 60 }));
    return unwrap(configureHost(t, byName(t, 'Notebook'), { ip: '10.1.1.10', mask: '24', dns: '10.1.1.53' }));
  },
  wlan: (t) => {
    t = unwrap(setWlan(t, byName(t, 'Access Point'), { ssid: 'Klasse', password: 'geheim123', band: '5', channel: 36 }));
    for (const [n, ip] of [['Notebook 1', '172.16.0.21'], ['Notebook 2', '172.16.0.22']] as const) {
      t = unwrap(setWifiClient(t, byName(t, n), { ssid: 'Klasse', password: 'geheim123' }));
      t = unwrap(configureHost(t, byName(t, n), { ip, mask: '24' }));
      t = unwrap(connect(t, byName(t, n), byName(t, 'Access Point'), 'wireless')).topology;
    }
    return t;
  },
  vlans: (t) => {
    const sw = byName(t, 'Switch');
    for (const p of [0, 1]) t = unwrap(setPortVlan(t, sw, p, 10));
    for (const p of [2, 3]) t = unwrap(setPortVlan(t, sw, p, 20));
    return t;
  },
  'router-on-a-stick': (t) => {
    const sw = byName(t, 'Switch');
    const r = byName(t, 'Router');
    t = unwrap(connect(t, r, sw)).topology;
    t = unwrap(setPortVlan(t, sw, 0, 10));
    t = unwrap(setPortVlan(t, sw, 1, 20));
    t = unwrap(setPortTrunk(t, sw, 2, true));
    t = unwrap(setSubinterface(t, r, 0, 10, '192.168.10.1', '24'));
    return unwrap(setSubinterface(t, r, 0, 20, '192.168.20.1', '24'));
  },
  'l3-campus': (t) => {
    const core = byName(t, 'Core');
    const a = byName(t, 'Gebäude A');
    const b = byName(t, 'Gebäude B');
    // Uplinks über Glasfaser mit SFP-Modulen.
    for (const id of [core, core, a, b]) t = unwrap(insertSfpModule(t, id, '10G-SR')).topology;
    t = unwrap(connect(t, core, a, 'fiber')).topology;
    t = unwrap(connect(t, core, b, 'fiber')).topology;
    const port = (dev: string, other: string) => t.cables.find((c) => (c.a.device === dev && c.b.device === other) || (c.b.device === dev && c.a.device === other))!;
    const end = (dev: string, other: string) => {
      const c = port(dev, other);
      return c.a.device === dev ? c.a.iface : c.b.iface;
    };
    t = unwrap(setPortVlan(t, core, 0, 99));
    for (const [dev, other] of [[core, a], [core, b], [a, core], [b, core]] as const) t = unwrap(setPortTrunk(t, dev, end(dev, other), true));
    t = unwrap(setPortVlan(t, a, 0, 10));
    t = unwrap(setPortVlan(t, b, 0, 20));
    t = unwrap(setSvi(t, core, 10, '10.10.0.1', '24'));
    t = unwrap(setSvi(t, core, 20, '10.20.0.1', '24'));
    t = unwrap(setSvi(t, core, 99, '10.99.0.1', '24'));
    t = unwrap(setInterfaceRelay(t, core, 100010, '10.99.0.10'));
    t = unwrap(setInterfaceRelay(t, core, 100020, '10.99.0.10'));
    const server = byName(t, 'DHCP-Server');
    t = unwrap(
      setDhcpServer(t, server, {
        ...getDevice(t, server)!.dhcpServer!,
        scopes: [
          { start: '10.10.0.100', end: '10.10.0.150', mask: '255.255.255.0', gateway: '10.10.0.1' },
          { start: '10.20.0.100', end: '10.20.0.150', mask: '255.255.255.0', gateway: '10.20.0.1' },
        ],
      }),
    );
    return t;
  },
};

describe('Aufgabenkatalog', () => {
  it('hat Aufgaben von 1 bis 5 Sternen', () => {
    expect(new Set(CATALOG.map((e) => e.stars))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it.each(CATALOG.map((e) => e.id))('%s: Startnetz ist gültig, ungelöst und hat eine funktionierende Musterlösung', (id) => {
    const entry = CATALOG.find((e) => e.id === id)!;
    const { topology, tasks } = entry.build();
    const parsed = parseProject(serializeProject(topology, tasks));
    expect(parsed.ok).toBe(true);
    expect(tasks.difficulty).toBe(entry.stars);
    expect(passed(topology, id).every((r) => r.passed)).toBe(false);
    const solved = SOLUTIONS[id]!(topology);
    const results = passed(solved, id, LOGS[id]?.(solved));
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });
});
