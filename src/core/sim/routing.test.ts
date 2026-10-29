import { describe as group, expect, it } from 'vitest';
import { connect, wouldLoopWithoutStp } from '../model/topology';
import { parseProject, serializeProject } from '../io/project';
import { buildRoutes } from '../net/routing';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

/** PC1 (192.168.1.10) – R1 – PC2 (192.168.2.10) */
function twoSubnets() {
  const net = new NetBuilder();
  const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
  const pc2 = net.host('PC2', '192.168.2.10', '24', '192.168.2.1');
  const r1 = net.router('R1', ['192.168.1.1/24', '192.168.2.1/24']);
  net.link(pc1, r1);
  net.link(r1, pc2);
  return { net, pc1, pc2, r1 };
}

function pingAndRun(net: NetBuilder, from: string, target: string) {
  const sim = new Simulation(net.topology);
  sim.ping(from, target);
  sim.runUntilIdle();
  const codes = sim.getDeviceState(from).console.map((l) => l.code);
  const log = sim.getPacketLog().map((e) => describe(net.topology, e));
  return { sim, codes, log };
}

group('Ping über einen Router (Abnahme M3)', () => {
  it('stellt zwischen zwei Subnetzen zu', () => {
    const { net, pc1 } = twoSubnets();
    const { sim, codes, log } = pingAndRun(net, pc1, '192.168.2.10');

    expect(log.slice(0, 8)).toEqual([
      'PC1→R1 ARP request 192.168.1.1',
      'R1→PC1 ARP reply 192.168.1.10',
      'PC1→R1 ICMP echoRequest 192.168.1.10>192.168.2.10',
      'R1→PC2 ARP request 192.168.2.10',
      'PC2→R1 ARP reply 192.168.2.1',
      'R1→PC2 ICMP echoRequest 192.168.1.10>192.168.2.10',
      'PC2→R1 ICMP echoReply 192.168.2.10>192.168.1.10',
      'R1→PC1 ICMP echoReply 192.168.2.10>192.168.1.10',
    ]);
    expect(codes.filter((c) => c === 'ping.reply')).toHaveLength(4);
    // Der Router senkt die TTL um eins.
    expect(sim.getDeviceState(pc1).console[1]!.params).toMatchObject({ ttl: 63 });
  });

  it('zeigt die Routingtabelle mit direkt verbundenen und statischen Routen', () => {
    const { net, r1 } = twoSubnets();
    net.route(r1, '10.0.0.0', '8', '192.168.2.254');
    const { routes, unusable } = buildRoutes(net.topology.devices.find((d) => d.id === r1)!);
    expect(routes.map((r) => `${r.kind}:${r.prefix}:eth${r.iface}`)).toEqual([
      'connected:24:eth0',
      'connected:24:eth1',
      'static:8:eth1',
    ]);
    expect(unusable).toEqual([]);
  });

  it('meldet statische Routen, deren Gateway nicht direkt erreichbar ist', () => {
    const { net, r1 } = twoSubnets();
    net.route(r1, '10.0.0.0', '8', '172.16.0.1');
    expect(buildRoutes(net.topology.devices.find((d) => d.id === r1)!).unusable).toEqual([0]);
  });
});

group('Fehlerfälle mit Gateway und Router', () => {
  it('erkennt ein Standardgateway, das nicht antwortet', () => {
    const net = new NetBuilder();
    const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.99');
    const r1 = net.router('R1', ['192.168.1.1/24', '192.168.2.1/24']);
    net.link(pc1, r1);
    const { codes } = pingAndRun(net, pc1, '192.168.2.10');
    expect(codes).toContain('ping.gatewayUnreachable');
    expect(codes).not.toContain('ping.reply');
  });

  it('erhält vom Router «Zielnetz nicht erreichbar», wenn ihm eine Route fehlt', () => {
    const { net, pc1 } = twoSubnets();
    const { sim, codes, log } = pingAndRun(net, pc1, '10.9.9.9');
    expect(codes.slice(0, 2)).toEqual(['ping.start', 'ping.netUnreachableFrom']);
    expect(sim.getDeviceState(pc1).console[1]!.params).toEqual({ from: '192.168.1.1' });
    expect(log).toContain('R1→PC1 ICMP destUnreachable 192.168.1.1>192.168.1.10');
  });

  it('erhält vom Router «Zielhost nicht erreichbar», wenn im Zielnetz niemand antwortet', () => {
    const { net, pc1 } = twoSubnets();
    const { codes } = pingAndRun(net, pc1, '192.168.2.99');
    expect(codes).toContain('ping.hostUnreachableFrom');
  });

  it('verwirft Pakete mit abgelaufener TTL und meldet das dem Absender', () => {
    // Zwei Router, die sich gegenseitig als Weg nach 10.0.0.0/8 nennen: Das Paket kreist, bis die TTL abläuft.
    const net = new NetBuilder();
    const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
    const r1 = net.router('R1', ['192.168.1.1/24', '172.16.0.1/30']);
    const r2 = net.router('R2', ['172.16.0.2/30', '192.168.9.1/24']);
    net.link(pc1, r1);
    net.link(r1, r2);
    net.route(r1, '10.0.0.0', '8', '172.16.0.2');
    net.route(r2, '10.0.0.0', '8', '172.16.0.1');
    net.route(r2, '192.168.1.0', '24', '172.16.0.1');
    const { codes, log } = pingAndRun(net, pc1, '10.1.1.1');
    expect(codes).toContain('ping.ttlExpired');
    expect(log.some((l) => l.includes('timeExceeded'))).toBe(true);
  });
});

group('Längster Präfix bei zwei passenden Routen', () => {
  it('wählt die spezifischere Route', () => {
    const net = new NetBuilder();
    const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
    const r1 = net.router('R1', ['192.168.1.1/24', '172.16.0.1/30', '172.16.1.1/30']);
    const r2 = net.router('R2', ['172.16.0.2/30', '10.0.0.1/8']);
    const r3 = net.router('R3', ['172.16.1.2/30', '10.1.0.1/16']);
    net.link(pc1, r1);
    net.link(r1, r2);
    net.link(r1, r3);
    net.route(r1, '10.0.0.0', '8', '172.16.0.2');
    net.route(r1, '10.1.0.0', '16', '172.16.1.2');

    const { log } = pingAndRun(net, pc1, '10.1.0.1');
    expect(log).toContain('R1→R3 ICMP echoRequest 192.168.1.10>10.1.0.1');
    expect(log.some((l) => l.startsWith('R1→R2 ICMP'))).toBe(false);
  });
});

group('Switch mit Lerntabelle', () => {
  function threeHostsOnSwitch() {
    const net = new NetBuilder();
    const a = net.host('PC1', '10.0.0.1');
    const b = net.host('PC2', '10.0.0.2');
    const c = net.host('PC3', '10.0.0.3');
    const sw = net.add('switch', 'S1');
    for (const pc of [a, b, c]) net.link(pc, sw);
    return { net, a, b, c, sw };
  }

  it('flutet Broadcasts an alle Ports und stellt bekannte Ziele gezielt zu', () => {
    const { net, a, sw } = threeHostsOnSwitch();
    const { sim, log } = pingAndRun(net, a, '10.0.0.2');

    expect(log.filter((l) => l.startsWith('S1→PC3'))).toEqual(['S1→PC3 ARP request 10.0.0.2']);
    expect(log.filter((l) => l.includes('echoRequest'))).toEqual(
      Array(4).fill(['PC1→S1 ICMP echoRequest 10.0.0.1>10.0.0.2', 'S1→PC2 ICMP echoRequest 10.0.0.1>10.0.0.2']).flat(),
    );
    expect(sim.getDeviceState(sw).macTable).toMatchObject([
      { mac: '02:00:00:00:01:00', port: 0 },
      { mac: '02:00:00:00:02:00', port: 1 },
    ]);
  });

  it('erlaubt Schleifen zwischen Switches, warnt aber ohne STP', () => {
    const net = new NetBuilder();
    const s1 = net.add('switch', 'S1');
    const s2 = net.add('switch', 'S2');
    const s3 = net.add('switch', 'S3');
    net.link(s1, s2);
    net.link(s2, s3);
    expect(wouldLoopWithoutStp(net.topology, s3, s1)).toBe(true);
    expect(connect(net.topology, s3, s1).ok).toBe(true);
  });

  it('liest Projektdateien mit Switch-Schleife (Broadcast-Sturm als Übung)', () => {
    const net = new NetBuilder();
    const s1 = net.add('switch', 'S1');
    const s2 = net.add('switch', 'S2');
    const s3 = net.add('switch', 'S3');
    net.link(s1, s2);
    net.link(s2, s3);
    const file = JSON.parse(serializeProject(net.topology));
    file.topology.cables.push({ id: 'c99', a: { device: s3, iface: 1 }, b: { device: s1, iface: 1 } });
    expect(parseProject(JSON.stringify(file)).ok).toBe(true);
  });

  it('lässt Router zwischen Switches zu, auch im Ring', () => {
    const net = new NetBuilder();
    const s1 = net.add('switch', 'S1');
    const s2 = net.add('switch', 'S2');
    const r1 = net.add('router', 'R1');
    net.link(s1, s2);
    net.link(s1, r1);
    expect(connect(net.topology, r1, s2).ok).toBe(true);
  });
});

group('Modem', () => {
  it('überträgt Rahmen unverändert zwischen seinen Anschlüssen', () => {
    const net = new NetBuilder();
    const a = net.host('PC1', '10.0.0.1');
    const b = net.host('PC2', '10.0.0.2');
    const m = net.add('modem', 'M1');
    net.link(a, m);
    net.link(m, b);
    const { codes, log } = pingAndRun(net, a, '10.0.0.2');
    expect(codes.filter((c) => c === 'ping.reply')).toHaveLength(4);
    expect(log.slice(0, 2)).toEqual(['PC1→M1 ARP request 10.0.0.2', 'M1→PC2 ARP request 10.0.0.2']);
  });
});
