import { describe as group, expect, it } from 'vitest';
import { setGroupSize } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder } from './testing';

function office(size: number, poolEnd: string) {
  const net = new NetBuilder();
  const server = net.host('Server', '192.168.10.2', '24', '192.168.10.1');
  net.dhcpServer(server, { start: '192.168.10.100', end: poolEnd, leaseTime: 3600, gateway: '192.168.10.1' });
  const sw = net.add('switch', 'SW');
  const team = net.add('clientgroup', 'Büro');
  net.apply((t) => setGroupSize(t, team, size));
  net.link(server, sw);
  net.link(team, sw);
  return { net, team, server };
}

group('Client-Gruppe', () => {
  it('jeder Rechner der Gruppe bezieht eine eigene Adresse per DHCP', () => {
    const { net, team, server } = office(30, '192.168.10.199');
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    const members = sim.getDeviceState(team).group!;
    expect(members).toHaveLength(30);
    const ips = members.map((m) => m.ip);
    expect(ips.every(Boolean)).toBe(true);
    expect(new Set(ips).size).toBe(30);
    expect(new Set(members.map((m) => m.mac)).size).toBe(30);
    sim.ping(team, '192.168.10.2', 7);
    sim.runUntil(20_000);
    expect(sim.getDeviceState(team).console.some((l) => l.code === 'ping.reply' && l.params?.member === 7)).toBe(true);
    expect(sim.getDeviceState(server).dhcpLeases).toHaveLength(30);
  });

  it('ist der DHCP-Bereich zu klein, bleiben Rechner ohne Adresse', () => {
    const { net, team } = office(30, '192.168.10.119');
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    const members = sim.getDeviceState(team).group!;
    expect(members.filter((m) => m.ip)).toHaveLength(20);
  });
});
