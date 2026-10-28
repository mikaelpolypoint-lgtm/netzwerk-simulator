import { describe as group, expect, it } from 'vitest';
import { checkDhcpServer } from '../net/dhcp';
import { getDevice } from '../model/topology';
import type { DhcpServerConfig } from '../model/types';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

const POOL: DhcpServerConfig = {
  start: '192.168.0.100',
  end: '192.168.0.102',
  gateway: '192.168.0.1',
  dns: '192.168.0.2',
  leaseTime: 60,
};

/** Server (192.168.0.2) und DHCP-Clients an einem Switch. */
function network(clients = 1, pool: DhcpServerConfig = POOL) {
  const net = new NetBuilder();
  const server = net.host('Server', '192.168.0.2', '24');
  net.dhcpServer(server, pool);
  const sw = net.add('switch', 'S1');
  net.link(server, sw);
  const ids = Array.from({ length: clients }, (_, i) => {
    const id = net.dhcpClient(`NB${i + 1}`);
    net.link(id, sw);
    return id;
  });
  return { net, server, clients: ids };
}

const dhcpLog = (net: NetBuilder, sim: Simulation) =>
  sim
    .getPacketLog()
    .map((e) => describe(net.topology, e))
    .filter((l) => l.includes('DHCP'));
const codes = (sim: Simulation, id: string) => sim.getDeviceState(id).console.map((l) => l.code);

group('DHCP-Bezug (Abnahme M4)', () => {
  it('zeigt die DORA-Folge Discover, Offer, Request, Ack', () => {
    const { net, clients } = network();
    const sim = new Simulation(net.topology);
    sim.runUntil(5000);

    expect(dhcpLog(net, sim)).toEqual([
      'NB1→S1 DHCP discover 0.0.0.0>255.255.255.255',
      'S1→Server DHCP discover 0.0.0.0>255.255.255.255',
      'Server→S1 DHCP offer 192.168.0.2>255.255.255.255',
      'S1→NB1 DHCP offer 192.168.0.2>255.255.255.255',
      'NB1→S1 DHCP request 0.0.0.0>255.255.255.255',
      'S1→Server DHCP request 0.0.0.0>255.255.255.255',
      'Server→S1 DHCP ack 192.168.0.2>255.255.255.255',
      'S1→NB1 DHCP ack 192.168.0.2>255.255.255.255',
    ]);
    expect(codes(sim, clients[0]!)).toEqual(['dhcp.discover', 'dhcp.bound']);
    expect(sim.getDeviceState(clients[0]!).address).toMatchObject({
      mode: 'dhcp',
      ip: '192.168.0.100',
      mask: '255.255.255.0',
      gateway: '192.168.0.1',
      dns: '192.168.0.2',
      server: '192.168.0.2',
    });
  });

  it('übergibt alle Optionen im Ack', () => {
    const { net } = network();
    const sim = new Simulation(net.topology);
    sim.runUntil(5000);
    const ack = sim.getPacketLog().find((e) => {
      const p = e.frame.payload;
      return p.kind === 'ipv4' && p.payload.kind === 'udp' && p.payload.payload.kind === 'dhcp' && p.payload.payload.op === 'ack';
    });
    const msg = ack?.frame.payload.kind === 'ipv4' && ack.frame.payload.payload.kind === 'udp' ? ack.frame.payload.payload : undefined;
    expect(msg).toMatchObject({ srcPort: 67, dstPort: 68, payload: { yourIp: '192.168.0.100', leaseTime: 60, mask: '255.255.255.0' } });
  });

  it('vergibt verschiedenen Clients verschiedene Adressen und merkt sie sich', () => {
    const { net, server, clients } = network(2);
    const sim = new Simulation(net.topology);
    sim.runUntil(5000);
    expect(clients.map((c) => sim.getDeviceState(c).address?.ip)).toEqual(['192.168.0.100', '192.168.0.101']);
    expect(sim.getDeviceState(server).dhcpLeases?.map((l) => l.ip)).toEqual(['192.168.0.100', '192.168.0.101']);
  });

  it('erneuert die Lease nach der halben Dauer direkt beim Server', () => {
    const { net, clients } = network();
    const sim = new Simulation(net.topology);
    sim.runUntil(31_000);

    const log = dhcpLog(net, sim);
    expect(log).toContain('NB1→S1 DHCP request 192.168.0.100>192.168.0.2');
    expect(log).toContain('S1→NB1 DHCP ack 192.168.0.2>192.168.0.100');
    expect(codes(sim, clients[0]!)).toEqual(['dhcp.discover', 'dhcp.bound', 'dhcp.renewed']);
    // Erste Lease bis ~60 s, nach der Erneuerung bei ~30 s gilt sie bis ~90 s.
    expect(sim.getDeviceState(clients[0]!).address?.expires).toBeGreaterThan(89_000);
  });

  it('gibt die Adresse mit "ipconfig /release" frei und bezieht mit "/renew" eine neue', () => {
    const { net, server, clients } = network();
    const nb = clients[0]!;
    const sim = new Simulation(net.topology);
    sim.runUntil(5000);
    sim.runCommand(nb, 'ipconfig /release');
    sim.runUntil(6000);
    expect(sim.getDeviceState(nb).address?.ip).toBeUndefined();
    expect(sim.getDeviceState(server).dhcpLeases).toEqual([]);
    expect(dhcpLog(net, sim)).toContain('NB1→S1 DHCP release 192.168.0.100>192.168.0.2');

    sim.runCommand(nb, 'ipconfig /renew');
    sim.runUntil(10_000);
    expect(sim.getDeviceState(nb).address?.ip).toBe('192.168.0.100');
  });

  it('kann nach dem Bezug pingen', () => {
    const { net, clients } = network();
    const sim = new Simulation(net.topology);
    sim.runUntil(5000);
    sim.ping(clients[0]!, '192.168.0.2');
    sim.runUntil(10_000);
    expect(codes(sim, clients[0]!).filter((c) => c === 'ping.reply')).toHaveLength(4);
  });
});

group('DHCP-Fehlerfälle', () => {
  it('meldet einen erschöpften Adressbereich', () => {
    const { net, server, clients } = network(2, { ...POOL, end: '192.168.0.100' });
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    expect(sim.getDeviceState(clients[0]!).address?.ip).toBe('192.168.0.100');
    expect(codes(sim, clients[1]!)).toEqual(['dhcp.discover', 'dhcp.noServer']);
    expect(codes(sim, server)).toContain('dhcpServer.exhausted');
  });

  it('gibt nach drei Discover-Versuchen ohne Server auf', () => {
    const net = new NetBuilder();
    const a = net.dhcpClient('NB1');
    const b = net.host('PC1', '10.0.0.1');
    net.link(a, b);
    const sim = new Simulation(net.topology);
    sim.runUntil(10_000);
    expect(dhcpLog(net, sim)).toHaveLength(3);
    expect(codes(sim, a)).toEqual(['dhcp.discover', 'dhcp.noServer']);
    sim.ping(a, '10.0.0.1');
    expect(codes(sim, a).at(-1)).toBe('ping.noLease');
  });

  it('prüft die Server-Konfiguration', () => {
    const { net, server } = network();
    const device = getDevice(net.topology, server)!;
    const issue = (config: Partial<DhcpServerConfig>) => checkDhcpServer(device, { ...POOL, ...config })?.code;
    expect(issue({})).toBeUndefined();
    expect(issue({ start: '10.0.0.5' })).toBe('dhcpRangeOutsideSubnet');
    expect(issue({ start: '192.168.0.120' })).toBe('dhcpRangeOrder');
    expect(issue({ start: '192.168.0.0' })).toBe('dhcpRangeReserved');
    expect(issue({ leaseTime: 5 })).toBe('dhcpLeaseTime');
    const notebookId = net.dhcpClient('NB9');
    expect(checkDhcpServer(getDevice(net.topology, notebookId)!, POOL)?.code).toBe('notAServer');
  });
});
