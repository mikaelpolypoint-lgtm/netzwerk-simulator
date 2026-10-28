import { describe as group, expect, it } from 'vitest';
import { parseIp } from '../net/ipv4';
import { removeCable } from '../model/topology';
import { lookupRoute, type Route } from './ip';
import { Simulation } from './simulation';
import { NetBuilder, describe, unwrap } from './testing';

function twoHosts() {
  const net = new NetBuilder();
  const a = net.host('PC1', '10.0.0.1');
  const b = net.host('PC2', '10.0.0.2');
  net.link(a, b);
  return { net, a, b };
}

const consoleCodes = (sim: Simulation, id: string) => sim.getDeviceState(id).console.map((l) => l.code);

group('Ping zwischen zwei direkt verbundenen Rechnern (Abnahme M2)', () => {
  it('löst erst per ARP auf und sendet dann ICMP', () => {
    const { net, a } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();

    expect(sim.getPacketLog().map((e) => describe(net.topology, e))).toEqual([
      'PC1→PC2 ARP request 10.0.0.2',
      'PC2→PC1 ARP reply 10.0.0.1',
      'PC1→PC2 ICMP echoRequest 10.0.0.1>10.0.0.2',
      'PC2→PC1 ICMP echoReply 10.0.0.2>10.0.0.1',
      'PC1→PC2 ICMP echoRequest 10.0.0.1>10.0.0.2',
      'PC2→PC1 ICMP echoReply 10.0.0.2>10.0.0.1',
      'PC1→PC2 ICMP echoRequest 10.0.0.1>10.0.0.2',
      'PC2→PC1 ICMP echoReply 10.0.0.2>10.0.0.1',
      'PC1→PC2 ICMP echoRequest 10.0.0.1>10.0.0.2',
      'PC2→PC1 ICMP echoReply 10.0.0.2>10.0.0.1',
    ]);
  });

  it('meldet Antwortzeiten und Statistik', () => {
    const { net, a } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();

    const lines = sim.getDeviceState(a).console;
    expect(lines.map((l) => l.code)).toEqual([
      'ping.start',
      'ping.reply',
      'ping.reply',
      'ping.reply',
      'ping.reply',
      'ping.summary',
    ]);
    // Erste Antwort braucht zusätzlich die ARP-Auflösung (2 × 1 ms).
    expect(lines.slice(1, 5).map((l) => l.params?.time)).toEqual([4, 2, 2, 2]);
    expect(lines[1]!.params).toMatchObject({ from: '10.0.0.2', ttl: 64, size: 32 });
    expect(lines[5]!.params).toMatchObject({ sent: 4, received: 4, lost: 0, percent: 0 });
  });

  it('füllt die ARP-Caches beider Seiten', () => {
    const { net, a, b } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();

    expect(sim.getDeviceState(a).arp).toMatchObject([{ ip: '10.0.0.2', mac: '02:00:00:00:02:00', iface: 0 }]);
    expect(sim.getDeviceState(b).arp).toMatchObject([{ ip: '10.0.0.1', mac: '02:00:00:00:01:00', iface: 0 }]);
  });

  it('ist deterministisch', () => {
    const run = () => {
      const { net, a } = twoHosts();
      const sim = new Simulation(net.topology);
      sim.ping(a, '10.0.0.2');
      sim.runUntilIdle();
      return { log: sim.getPacketLog(), console: sim.getDeviceState(a).console };
    };
    expect(run()).toEqual(run());
  });
});

group('Fehlerfälle beim Ping', () => {
  it('meldet einen nicht vorhandenen Zielrechner nach erfolglosem ARP', () => {
    const { net, a } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.99');
    sim.runUntilIdle();

    const arpRequests = sim.getPacketLog().filter((e) => e.frame.payload.kind === 'arp');
    expect(arpRequests).toHaveLength(8); // 4 Pings × 2 Versuche
    expect(consoleCodes(sim, a)).toEqual([
      'ping.start',
      'ping.hostUnreachable',
      'ping.hostUnreachable',
      'ping.hostUnreachable',
      'ping.hostUnreachable',
      'ping.summary',
    ]);
  });

  it('meldet fehlendes Gateway, ohne etwas zu senden', () => {
    const { net, a } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '192.168.5.5');
    sim.runUntilIdle();
    expect(consoleCodes(sim, a)).toEqual(['ping.noRoute']);
    expect(sim.getPacketLog()).toHaveLength(0);
  });

  it('meldet ein fehlendes Kabel und eine fehlende IP-Adresse', () => {
    const net = new NetBuilder();
    const a = net.host('PC1', '10.0.0.1');
    const b = net.add('notebook', 'NB1');
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.ping(b, '10.0.0.1');
    expect(consoleCodes(sim, a)).toEqual(['ping.noLink']);
    expect(consoleCodes(sim, b)).toEqual(['ping.noAddress']);
  });

  it('erkennt ungültige Zieladressen', () => {
    const { net, a } = twoHosts();
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.300');
    expect(sim.getDeviceState(a).console).toMatchObject([{ code: 'ping.invalidTarget', params: { target: '10.0.0.300' } }]);
  });

  it('antwortet auf die eigene Adresse auch ohne Kabel', () => {
    const net = new NetBuilder();
    const a = net.host('PC1', '10.0.0.1');
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.1');
    sim.runUntilIdle();
    expect(consoleCodes(sim, a).filter((c) => c === 'ping.reply')).toHaveLength(4);
    expect(sim.getPacketLog()).toHaveLength(0);
  });
});

group('Kabel und Switch', () => {
  it('leitet über einen Switch an alle Ports weiter, nur das Ziel antwortet', () => {
    const net = new NetBuilder();
    const a = net.host('PC1', '10.0.0.1');
    const b = net.host('PC2', '10.0.0.2');
    const c = net.host('PC3', '10.0.0.3');
    const sw = net.add('switch', 'S1');
    for (const pc of [a, b, c]) net.link(pc, sw);

    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();

    const first = sim.getPacketLog().slice(0, 4).map((e) => describe(net.topology, e));
    expect(first).toEqual([
      'PC1→S1 ARP request 10.0.0.2',
      'S1→PC2 ARP request 10.0.0.2',
      'S1→PC3 ARP request 10.0.0.2',
      'PC2→S1 ARP reply 10.0.0.1',
    ]);
    expect(consoleCodes(sim, a).filter((code) => code === 'ping.reply')).toHaveLength(4);
    expect(sim.getDeviceState(c).arp).toEqual([]);
  });

  it('verliert Rahmen, deren Kabel während der Übertragung entfernt wird', () => {
    const { net, a } = twoHosts();
    const cable = net.topology.cables[0]!.id;
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.updateTopology(unwrap(removeCable(net.topology, cable)));
    sim.runUntil(10);
    expect(sim.getPacketLog().map((e) => e.status)).toEqual(['lost']);
  });
});

group('Routenwahl', () => {
  it('bevorzugt den längsten passenden Präfix', () => {
    const ip = (s: string) => parseIp(s)!;
    const routes: Route[] = [
      { network: 0, prefix: 0, iface: 0, via: ip('10.0.0.1') },
      { network: ip('192.168.0.0'), prefix: 16, iface: 1, via: ip('10.0.1.1') },
      { network: ip('192.168.7.0'), prefix: 24, iface: 2, via: null },
    ];
    expect(lookupRoute(routes, ip('192.168.7.9'))?.iface).toBe(2);
    expect(lookupRoute(routes, ip('192.168.8.9'))?.iface).toBe(1);
    expect(lookupRoute(routes, ip('8.8.8.8'))?.iface).toBe(0);
    expect(lookupRoute(routes.slice(1), ip('8.8.8.8'))).toBeUndefined();
  });
});
