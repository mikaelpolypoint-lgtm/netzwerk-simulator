import { describe as group, expect, it } from 'vitest';
import { removeCable, setBgp, setOspf, setOspfCost, setRip } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder } from './testing';
import { parseIp } from '../net/ipv4';

const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply');
const routeTo = (sim: Simulation, router: string, net: string) =>
  sim.getRoutes(router).find((r) => r.network === parseIp(net));

/**
 *        PC1                         PC3
 *         |                           |
 *        R1 ---- 10.0.12.0/30 ----   R2
 *          \                        /
 *     10.0.13.0/30            10.0.23.0/30
 *            \                    /
 *                     R3
 */
function triangle(protocol: 'ospf' | 'rip') {
  const net = new NetBuilder();
  const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
  const pc3 = net.host('PC3', '192.168.2.10', '24', '192.168.2.1');
  const r1 = net.router('R1', ['192.168.1.1/24', '10.0.12.1/30', '10.0.13.1/30']);
  const r2 = net.router('R2', ['192.168.2.1/24', '10.0.12.2/30', '10.0.23.2/30']);
  const r3 = net.router('R3', ['10.0.13.3/30', '10.0.23.3/30']);
  net.link(pc1, r1);
  net.link(pc3, r2);
  const r1r2 = net.link(r1, r2);
  net.link(r1, r3);
  net.link(r2, r3);
  const all = [{ network: '0.0.0.0', mask: '0', area: 0 }].map((n) => ({ ...n, mask: '0.0.0.0' }));
  for (const r of [r1, r2, r3]) {
    if (protocol === 'ospf') net.apply((t) => setOspf(t, r, { networks: all }));
    else net.apply((t) => setRip(t, r, { networks: [{ network: '0.0.0.0', mask: '0.0.0.0' }] }));
  }
  return { net, pc1, pc3, r1, r2, r3, r1r2 };
}

group('OSPF', () => {
  it('Nachbarn werden «Full», Routen werden gelernt, Ping klappt', () => {
    const { net, pc1, r1 } = triangle('ospf');
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    const ospf = sim.getDeviceState(r1).ospf!;
    expect(ospf.neighbors.map((n) => n.state)).toEqual(['full', 'full']);
    expect(routeTo(sim, r1, '192.168.2.0')).toMatchObject({ kind: 'ospf', metric: 20, via: parseIp('10.0.12.2') });
    sim.ping(pc1, '192.168.2.10');
    sim.runUntil(20_000);
    expect(replies(sim, pc1)).toHaveLength(4);
    const types = new Set(sim.getPacketLog().flatMap((e) => (e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'ospf' ? [e.frame.payload.payload.type] : [])));
    expect([...types].sort()).toEqual(['dbd', 'hello', 'lsack', 'lsu'].sort().concat(types.has('lsr') ? ['lsr'] : []).sort());
  });

  it('fällt eine Leitung aus, rechnet OSPF einen neuen Weg', () => {
    const { net, pc1, r1, r1r2 } = triangle('ospf');
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    net.apply((t) => removeCable(t, r1r2));
    sim.updateTopology(net.topology);
    sim.runUntil(30_000);
    expect(routeTo(sim, r1, '192.168.2.0')).toMatchObject({ kind: 'ospf', metric: 30, via: parseIp('10.0.13.3') });
    sim.ping(pc1, '192.168.2.10');
    sim.runUntil(40_000);
    expect(replies(sim, pc1)).toHaveLength(4);
  });

  it('Kosten beeinflussen den Weg', () => {
    const { net, r1 } = triangle('ospf');
    net.apply((t) => setOspfCost(t, r1, 1, 100));
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    expect(routeTo(sim, r1, '192.168.2.0')).toMatchObject({ metric: 30, via: parseIp('10.0.13.3') });
  });

  it('unterschiedliche Area: keine Nachbarschaft', () => {
    const { net, r2 } = triangle('ospf');
    net.apply((t) => setOspf(t, r2, { networks: [{ network: '0.0.0.0', mask: '0.0.0.0', area: 1 }] }));
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    expect(sim.getDeviceState(r2).ospf!.neighbors).toHaveLength(0);
    expect(sim.getDeviceState(r2).console.some((l) => l.code === 'ospf.areaMismatch')).toBe(true);
  });
});

group('RIP', () => {
  it('lernt Netze mit Hop-Anzahl und findet bei Ausfall einen anderen Weg', () => {
    const { net, pc1, r1, r1r2 } = triangle('rip');
    const sim = new Simulation(net.topology);
    sim.runUntil(12_000);
    expect(routeTo(sim, r1, '192.168.2.0')).toMatchObject({ kind: 'rip', metric: 1, via: parseIp('10.0.12.2') });
    sim.ping(pc1, '192.168.2.10');
    sim.runUntil(20_000);
    expect(replies(sim, pc1)).toHaveLength(4);
    net.apply((t) => removeCable(t, r1r2));
    sim.updateTopology(net.topology);
    sim.runUntil(70_000);
    expect(routeTo(sim, r1, '192.168.2.0')).toMatchObject({ kind: 'rip', metric: 2, via: parseIp('10.0.13.3') });
  });
});

group('BGP', () => {
  /** AS 65001 (R1 mit Netz 10.1.0.0/16) – AS 65002 (R2) – AS 65003 (R3 mit Netz 10.3.0.0/16) */
  function chain() {
    const net = new NetBuilder();
    const pc1 = net.host('PC1', '10.1.0.10', '16', '10.1.0.1');
    const pc3 = net.host('PC3', '10.3.0.10', '16', '10.3.0.1');
    const r1 = net.router('R1', ['10.1.0.1/16', '172.16.12.1/30']);
    const r2 = net.router('R2', ['172.16.12.2/30', '172.16.23.2/30']);
    const r3 = net.router('R3', ['172.16.23.3/30', '10.3.0.1/16']);
    net.link(pc1, r1);
    net.link(r1, r2);
    net.link(r2, r3);
    net.link(r3, pc3);
    net.apply((t) => setBgp(t, r1, { asn: 65001, neighbors: [{ ip: '172.16.12.2', remoteAs: 65002 }], networks: [{ network: '10.1.0.0', mask: '255.255.0.0' }] }));
    net.apply((t) => setBgp(t, r2, { asn: 65002, neighbors: [{ ip: '172.16.12.1', remoteAs: 65001 }, { ip: '172.16.23.3', remoteAs: 65003 }], networks: [] }));
    net.apply((t) => setBgp(t, r3, { asn: 65003, neighbors: [{ ip: '172.16.23.2', remoteAs: 65002 }], networks: [{ network: '10.3.0.0', mask: '255.255.0.0' }] }));
    return { net, pc1, r1, r2, r3 };
  }

  it('Sitzungen über TCP 179, AS-Pfad wächst über die Systeme hinweg', () => {
    const { net, pc1, r1, r2 } = chain();
    const sim = new Simulation(net.topology);
    sim.runUntil(15_000);
    expect(sim.getDeviceState(r2).bgp!.map((p) => p.state)).toEqual(['established', 'established']);
    expect(routeTo(sim, r1, '10.3.0.0')).toMatchObject({ kind: 'bgp', metric: 2, via: parseIp('172.16.12.2') });
    sim.ping(pc1, '10.3.0.10');
    sim.runUntil(25_000);
    expect(replies(sim, pc1)).toHaveLength(4);
  });

  it('falsche AS-Nummer beim Nachbarn: Sitzung kommt nicht zustande', () => {
    const { net, r1, r2 } = chain();
    net.apply((t) => setBgp(t, r1, { asn: 65009, neighbors: [{ ip: '172.16.12.2', remoteAs: 65002 }], networks: [] }));
    const sim = new Simulation(net.topology);
    sim.runUntil(15_000);
    expect(sim.getDeviceState(r2).bgp![0]!.state).not.toBe('established');
    expect(sim.getDeviceState(r2).console.some((l) => l.code === 'bgp.badPeerAs')).toBe(true);
  });
});
