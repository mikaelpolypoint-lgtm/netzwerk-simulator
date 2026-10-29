import { describe as group, expect, it } from 'vitest';
import { connect, wouldLoopWithoutStp, removeCable, setPortTrunk, setPortVlan, setStp, setStpPriority } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, describe, unwrap } from './testing';

const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply').length;

group('VLANs', () => {
  /** PC1 und PC2 in VLAN 10, PC3 in VLAN 20, alle im selben IP-Netz an einem Switch. */
  function oneSwitch() {
    const net = new NetBuilder();
    const pcs = ['PC1', 'PC2', 'PC3'].map((name, i) => net.host(name, `10.0.0.${i + 1}`));
    const sw = net.add('switch', 'S1');
    pcs.forEach((pc) => net.link(pc, sw));
    net.topology = unwrap(setPortVlan(net.topology, sw, 0, 10));
    net.topology = unwrap(setPortVlan(net.topology, sw, 1, 10));
    net.topology = unwrap(setPortVlan(net.topology, sw, 2, 20));
    return { net, pcs, sw };
  }

  it('trennt Broadcasts und Verkehr nach VLAN', () => {
    const { net, pcs } = oneSwitch();
    const sim = new Simulation(net.topology);
    sim.ping(pcs[0]!, '10.0.0.2');
    sim.ping(pcs[2]!, '10.0.0.1');
    sim.runUntilIdle();
    expect(replies(sim, pcs[0]!)).toBe(4);
    expect(replies(sim, pcs[2]!)).toBe(0);
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log.some((l) => l.startsWith('S1→PC3') && l.includes('10.0.0.2'))).toBe(false);
    expect(sim.getDeviceState(net.topology.devices.find((d) => d.name === 'S1')!.id).macTable).toMatchObject([
      { vlan: 10, port: 0 },
      { vlan: 10, port: 1 },
      { vlan: 20, port: 2 },
    ]);
  });

  it('überträgt VLANs über einen Trunk mit 802.1Q-Tag', () => {
    const net = new NetBuilder();
    const a = net.host('A', '10.0.0.1');
    const b = net.host('B', '10.0.0.2');
    const s1 = net.add('switch', 'S1');
    const s2 = net.add('switch', 'S2');
    net.link(a, s1);
    net.link(s1, s2);
    net.link(b, s2);
    for (const [sw, access, trunk] of [[s1, 0, 1], [s2, 1, 0]] as const) {
      net.topology = unwrap(setPortVlan(net.topology, sw, access, 10));
      net.topology = unwrap(setPortTrunk(net.topology, sw, trunk, true));
    }
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    expect(replies(sim, a)).toBe(4);
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log).toContain('S1→S2 [VLAN 10] ARP request 10.0.0.2');
    expect(log).toContain('S2→B ARP request 10.0.0.2');
  });
});

group('Spanning Tree', () => {
  /** Dreieck aus drei Switches mit STP, PC1 an S1, PC2 an S3. */
  function triangle() {
    const net = new NetBuilder();
    const pc1 = net.host('PC1', '10.0.0.1');
    const pc2 = net.host('PC2', '10.0.0.2');
    const [s1, s2, s3] = ['S1', 'S2', 'S3'].map((name) => net.add('switch', name)) as [string, string, string];
    for (const sw of [s1, s2, s3]) net.topology = unwrap(setStp(net.topology, sw, true));
    net.link(pc1, s1);
    net.link(pc2, s3);
    net.link(s1, s2);
    net.link(s2, s3);
    const closing = net.link(s3, s1);
    return { net, pc1, pc2, s1, s2, s3, closing };
  }

  it('warnt vor Schleifen nur, solange nicht alle beteiligten Switches STP haben', () => {
    const net = new NetBuilder();
    const [s1, s2, s3] = ['S1', 'S2', 'S3'].map((name) => net.add('switch', name)) as [string, string, string];
    net.link(s1, s2);
    net.link(s2, s3);
    expect(wouldLoopWithoutStp(net.topology, s3, s1)).toBe(true);
    for (const sw of [s1, s2, s3]) net.topology = unwrap(setStp(net.topology, sw, true));
    expect(wouldLoopWithoutStp(net.topology, s3, s1)).toBe(false);
    net.link(s3, s1);
    expect(setStp(net.topology, s2, false).ok).toBe(true);
  });

  it('wählt eine Root-Bridge, blockiert einen Port und verhindert so den Broadcast-Sturm', () => {
    const { net, pc1, s1, s2, s3 } = triangle();
    const sim = new Simulation(net.topology);
    sim.runUntil(6000);
    const states = [s1, s2, s3].map((id) => sim.getDeviceState(id).stp!);
    // S1 hat die kleinste MAC-Adresse und wird Root-Bridge.
    expect(new Set(states.map((s) => s.rootId)).size).toBe(1);
    expect(states[0]!.rootId).toBe(states[0]!.bridgeId);
    const blocked = states.flatMap((s) => s.ports.filter((p) => p.state === 'blocking'));
    expect(blocked).toHaveLength(1);

    const before = sim.getPacketLog().length;
    sim.ping(pc1, '10.0.0.2');
    sim.runUntil(12_000);
    expect(replies(sim, pc1)).toBe(4);
    // Kein Sturm: nur eine überschaubare Zahl Rahmen trotz Schleife.
    expect(sim.getPacketLog().length - before).toBeLessThan(120);
  });

  it('gibt nach dem Ausfall einer Verbindung den blockierten Port frei', () => {
    const { net, pc1, s2, s3, closing } = triangle();
    const sim = new Simulation(net.topology);
    sim.runUntil(6000);
    // S1 ist Root; blockiert ist die Verbindung S2–S3 (auf der Seite von S3).
    const blockedBefore = [s2, s3].flatMap((id) => sim.getDeviceState(id).stp!.ports.filter((p) => p.state === 'blocking'));
    expect(blockedBefore).toHaveLength(1);

    // Die direkte Verbindung S1–S3 fällt aus: Der Weg führt jetzt über S2.
    sim.updateTopology(unwrap(removeCable(net.topology, closing)));
    sim.runUntil(20_000);
    expect([s2, s3].flatMap((id) => sim.getDeviceState(id).stp!.ports.filter((p) => p.state === 'blocking'))).toEqual([]);
    sim.ping(pc1, '10.0.0.2');
    sim.runUntil(30_000);
    expect(replies(sim, pc1)).toBe(4);
  });

  it('macht mit kleinerer Priorität einen anderen Switch zur Root-Bridge', () => {
    const { net, s1, s3 } = triangle();
    net.topology = unwrap(setStpPriority(net.topology, s3, 4096));
    const sim = new Simulation(net.topology);
    sim.runUntil(6000);
    expect(sim.getDeviceState(s1).stp?.rootId).toBe(sim.getDeviceState(s3).stp?.bridgeId);
    expect(sim.getDeviceState(s3).stp?.rootId.startsWith('4096.')).toBe(true);
    expect(sim.getPacketLog().some((e) => e.frame.payload.kind === 'stp')).toBe(true);
  });
});
