import { describe as group, expect, it } from 'vitest';
import { addStaticRoute, setIpRouting, setPortTrunk, setPortVlan, setSubinterface, setSvi, setInterfaceRelay } from '../model/topology';
import { parseProject, serializeProject } from '../io/project';
import { buildRoutes, subifId, sviId } from '../net/routing';
import { Simulation } from './simulation';
import { NetBuilder, describe, unwrap } from './testing';

const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply').length;

group('Router-on-a-Stick', () => {
  /** PC10 in VLAN 10, PC20 in VLAN 20; der Router hängt mit einem Kabel am Trunk-Port des Switches. */
  function build() {
    const net = new NetBuilder();
    const pc10 = net.host('PC10', '192.168.10.10', '24', '192.168.10.1');
    const pc20 = net.host('PC20', '192.168.20.10', '24', '192.168.20.1');
    const sw = net.add('switch', 'S1');
    const r = net.add('router', 'R1');
    net.link(pc10, sw);
    net.link(pc20, sw);
    net.link(r, sw);
    net.topology = unwrap(setPortVlan(net.topology, sw, 0, 10));
    net.topology = unwrap(setPortVlan(net.topology, sw, 1, 20));
    net.topology = unwrap(setPortTrunk(net.topology, sw, 2, true));
    net.topology = unwrap(setSubinterface(net.topology, r, 0, 10, '192.168.10.1', '24'));
    net.topology = unwrap(setSubinterface(net.topology, r, 0, 20, '192.168.20.1', '24'));
    return { net, pc10, pc20, sw, r };
  }

  it('routet zwischen VLANs über getaggte Subinterfaces', () => {
    const { net, pc10 } = build();
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '192.168.20.10');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(4);
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log).toContain('S1→R1 [VLAN 10] ARP request 192.168.10.1');
    expect(log).toContain('R1→S1 [VLAN 20] ARP request 192.168.20.10');
    expect(log).toContain('S1→PC20 ARP request 192.168.20.10');
  });

  it('pingt aus der Befehlszeile des Routers in beide VLANs', () => {
    const { net, r } = build();
    const sim = new Simulation(net.topology);
    sim.ping(r, '192.168.20.10');
    sim.runUntilIdle();
    expect(replies(sim, r)).toBe(4);
  });

  it('zeigt die Subinterfaces in der Routingtabelle', () => {
    const { net, r } = build();
    const routes = buildRoutes(net.topology.devices.find((d) => d.id === r)!).routes;
    expect(routes.map((x) => x.iface)).toEqual([subifId(0, 10), subifId(0, 20)]);
  });

  it('verwirft getaggte Rahmen ohne passendes Subinterface', () => {
    const { net, r, pc10 } = build();
    net.topology = { ...net.topology, devices: net.topology.devices.map((d) => (d.id === r ? { ...d, subinterfaces: d.subinterfaces!.slice(1) } : d)) };
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '192.168.20.10');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(0);
  });

  it('bleibt beim Speichern und Laden erhalten', () => {
    const { net, r } = build();
    net.topology = unwrap(setInterfaceRelay(net.topology, r, subifId(0, 20), '192.168.10.5'));
    net.topology = unwrap(addStaticRoute(net.topology, r, { network: '10.0.0.0', mask: '8', gateway: '192.168.20.254' }));
    const parsed = parseProject(serializeProject(net.topology));
    expect(parsed.ok && parsed.topology).toEqual(net.topology);
  });
});

group('Layer-3-Switch', () => {
  function build() {
    const net = new NetBuilder();
    const pc10 = net.host('PC10', '10.10.0.10', '24', '10.10.0.1');
    const pc20 = net.host('PC20', '10.20.0.10', '24', '10.20.0.1');
    const sw = net.add('l3switch', 'L3');
    net.link(pc10, sw);
    net.link(pc20, sw);
    net.topology = unwrap(setPortVlan(net.topology, sw, 0, 10));
    net.topology = unwrap(setPortVlan(net.topology, sw, 1, 20));
    net.topology = unwrap(setSvi(net.topology, sw, 10, '10.10.0.1', '24'));
    net.topology = unwrap(setSvi(net.topology, sw, 20, '10.20.0.1', '24'));
    return { net, pc10, pc20, sw };
  }

  it('routet zwischen VLANs über SVIs', () => {
    const { net, pc10, sw } = build();
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '10.20.0.10');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(4);
    const state = sim.getDeviceState(sw) as { arp?: { ip: string; iface: number }[]; macTable?: unknown[] };
    expect(state.arp).toContainEqual(expect.objectContaining({ ip: '10.20.0.10', iface: sviId(20) }));
    expect(state.macTable?.length).toBeGreaterThan(0);
  });

  it('pingt aus der Befehlszeile des Layer-3-Switches', () => {
    const { net, sw } = build();
    const sim = new Simulation(net.topology);
    sim.ping(sw, '10.20.0.10');
    sim.runUntilIdle();
    expect(replies(sim, sw)).toBe(4);
  });

  it('antwortet auf Ping an die eigene SVI', () => {
    const { net, pc10 } = build();
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '10.10.0.1');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(4);
  });

  it('leitet mit «no ip routing» nicht weiter', () => {
    const { net, pc10, sw } = build();
    net.topology = unwrap(setIpRouting(net.topology, sw, false));
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '10.20.0.10');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(0);
  });

  it('erreicht über einen Trunk Rechner an einem anderen Switch', () => {
    const { net, sw } = build();
    const access = net.add('switch', 'S2');
    const pc30 = net.host('PC30', '10.30.0.10', '24', '10.30.0.1');
    net.link(sw, access);
    net.link(pc30, access);
    net.topology = unwrap(setPortTrunk(net.topology, sw, 2, true));
    net.topology = unwrap(setPortTrunk(net.topology, access, 0, true));
    net.topology = unwrap(setPortVlan(net.topology, access, 1, 30));
    net.topology = unwrap(setSvi(net.topology, sw, 30, '10.30.0.1', '24'));
    const pc10 = net.topology.devices.find((d) => d.name === 'PC10')!.id;
    const sim = new Simulation(net.topology);
    sim.ping(pc10, '10.30.0.10');
    sim.runUntilIdle();
    expect(replies(sim, pc10)).toBe(4);
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log).toContain('L3→S2 [VLAN 30] ARP request 10.30.0.10');
  });
});
