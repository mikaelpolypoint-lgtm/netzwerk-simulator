import { describe as group, expect, it } from 'vitest';
import { linkStatus } from '../model/links';
import { getCable, setEncapsulation } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

/** PC1 – R1 ==seriell== R2 – PC2 */
function wan(encapsulation: 'hdlc' | 'ppp') {
  const net = new NetBuilder();
  const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
  const pc2 = net.host('PC2', '192.168.2.10', '24', '192.168.2.1');
  const r1 = net.router('R1', ['192.168.1.1/24', '10.0.0.1/30']);
  const r2 = net.router('R2', ['192.168.2.1/24', '10.0.0.2/30']);
  net.serial(r1, 1, encapsulation);
  net.serial(r2, 1, encapsulation);
  net.link(pc1, r1);
  const line = net.link(r1, r2, 'serial');
  net.link(r2, pc2);
  net.route(r1, '192.168.2.0', '255.255.255.0', '10.0.0.2');
  net.route(r2, '192.168.1.0', '255.255.255.0', '10.0.0.1');
  return { net, pc1, pc2, r1, r2, line };
}

group('Serielle Leitungen', () => {
  it('HDLC: Ping über die serielle Leitung, ohne ARP auf der Leitung', () => {
    const { net, pc1, r1, r2 } = wan('hdlc');
    const sim = new Simulation(net.topology);
    sim.ping(pc1, '192.168.2.10');
    sim.runUntil(20_000);
    const serial = sim.getPacketLog().filter((e) => e.frame.l2);
    expect(serial.length).toBeGreaterThan(0);
    expect(serial.every((e) => e.frame.l2 === 'hdlc' && e.frame.payload.kind !== 'arp')).toBe(true);
    expect(serial.some((e) => e.from.device === r1 && e.to.device === r2)).toBe(true);
    expect(sim.getDeviceState(pc1).console.map((l) => l.code)).toContain('ping.reply');
  });

  it('PPP: zuerst LCP und IPCP, dann IP', () => {
    const { net, pc1 } = wan('ppp');
    const sim = new Simulation(net.topology);
    sim.runUntil(100);
    const ppp = sim.getPacketLog().filter((e) => e.frame.payload.kind === 'ppp').map((e) => describe(net.topology, e));
    expect(ppp).toEqual([
      'R1→R2 PPP LCP configureRequest',
      'R2→R1 PPP LCP configureRequest',
      'R2→R1 PPP LCP configureAck',
      'R1→R2 PPP LCP configureAck',
      'R1→R2 PPP IPCP configureRequest',
      'R2→R1 PPP IPCP configureRequest',
      'R2→R1 PPP IPCP configureAck',
      'R1→R2 PPP IPCP configureAck',
    ]);
    sim.ping(pc1, '192.168.2.10');
    sim.runUntil(20_000);
    expect(sim.getDeviceState(pc1).console.map((l) => l.code)).toContain('ping.reply');
  });

  it('unterschiedliche Kapselung: Leitung bleibt unten', () => {
    const { net, r2, line } = wan('hdlc');
    net.apply((t) => setEncapsulation(t, r2, 1, 'ppp'));
    expect(linkStatus(net.topology, getCable(net.topology, line)!)).toMatchObject({ up: false, reason: 'encapsulationMismatch' });
  });

  it('serielle Leitung nur zwischen seriellen Anschlüssen', () => {
    const net = new NetBuilder();
    const r1 = net.router('R1', ['10.0.0.1/30', '10.0.1.1/24']);
    const r2 = net.router('R2', ['10.0.0.2/30', '10.0.2.1/24']);
    expect(() => net.link(r1, r2, 'serial')).toThrow(/mediumNotSupported/);
  });
});
