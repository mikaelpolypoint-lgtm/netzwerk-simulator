import { describe as group, expect, it } from 'vitest';
import { addDevice, setBgp, setOspf } from '../model/topology';
import { Simulation } from '../sim/simulation';
import { NetBuilder, unwrap } from '../sim/testing';
import { dissect } from './encode';
import { internetChecksum } from './part';
import { toPcapng } from './pcap';

/** Netz mit möglichst vielen Protokollen: DHCP, DNS, HTTP, ARP, ICMP, OSPF, BGP, STP, 802.1Q. */
function busy() {
  const net = new NetBuilder();
  const server = net.host('Server', '192.168.1.2', '24', '192.168.1.1');
  net.dhcpServer(server, { start: '192.168.1.100', end: '192.168.1.150', leaseTime: 3600, gateway: '192.168.1.1', dns: '192.168.1.2' });
  net.dnsServer(server, [['web', '10.9.0.10']]);
  const client = net.dhcpClient('Client');
  const sw = net.add('switch', 'SW');
  const r1 = net.router('R1', ['192.168.1.1/24', '10.0.0.1/30']);
  const r2 = net.router('R2', ['10.0.0.2/30', '10.9.0.1/24']);
  const web = net.host('Web', '10.9.0.10', '24', '10.9.0.1');
  net.webServer(web, { '/index.html': '<h1>Hallo Welt – äöü</h1>' });
  net.link(server, sw);
  net.link(client, sw);
  net.link(sw, r1);
  net.link(r1, r2);
  net.link(r2, web);
  const all = [{ network: '0.0.0.0', mask: '0.0.0.0', area: 0 }];
  net.apply((t) => setOspf(t, r1, { networks: all }));
  net.apply((t) => setOspf(t, r2, { networks: all }));
  net.apply((t) => setBgp(t, r1, { asn: 65001, neighbors: [{ ip: '10.0.0.2', remoteAs: 65002 }], networks: [{ network: '192.168.1.0', mask: '255.255.255.0' }] }));
  net.apply((t) => setBgp(t, r2, { asn: 65002, neighbors: [{ ip: '10.0.0.1', remoteAs: 65001 }], networks: [] }));
  const sim = new Simulation(net.topology);
  sim.runUntil(8000);
  sim.browse(client, 'http://web/index.html');
  sim.runUntil(20_000);
  return { net, sim, client };
}

group('Kodierung nach Norm', () => {
  it('jeder Rahmen lässt sich kodieren; IPv4-, ICMP-, UDP-, TCP- und OSPF-Prüfsummen stimmen', () => {
    const { sim } = busy();
    const log = sim.getPacketLog();
    const protocols = new Set<string>();
    for (const entry of log) {
      const d = dissect(entry.frame);
      for (const l of d.layers) protocols.add(l.protocol);
      const ip = d.layers.find((l) => l.protocol === 'IPv4');
      if (!ip) continue;
      const header = d.bytes.slice(ip.start, ip.start + 20);
      expect(internetChecksum(header)).toBe(0);
      const totalLength = (header[2]! << 8) | header[3]!;
      expect(totalLength).toBe(ip.length);
      const proto = header[9]!;
      const payload = d.bytes.slice(ip.start + 20, ip.start + totalLength);
      const pseudo = [...header.slice(12, 20), 0, proto, payload.length >> 8, payload.length & 0xff];
      if (proto === 6 || proto === 17) expect(internetChecksum([...pseudo, ...payload])).toBe(0);
      if (proto === 1) expect(internetChecksum(payload)).toBe(0);
      if (proto === 89) expect(internetChecksum([...payload.slice(0, 16), ...payload.slice(24)])).toBe(0);
    }
    for (const p of ['Ethernet II', 'ARP', 'IPv4', 'UDP', 'DHCP', 'DNS', 'TCP', 'HTTP', 'OSPFv2', 'BGP-4']) expect(protocols).toContain(p);
  });

  it('jede Schicht nennt ihre OSI-Ebene; Schicht 1 beschreibt das Medium', () => {
    const { sim } = busy();
    const http = sim.getPacketLog().find((e) => e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'tcp' && e.frame.payload.payload.data.startsWith('GET'))!;
    const d = dissect(http.frame);
    expect(d.layers.map((l) => [l.osi, l.protocol])).toEqual([
      [1, '1000BASE-T (IEEE 802.3ab)'],
      [2, 'Ethernet II'],
      [3, 'IPv4'],
      [4, 'TCP'],
      [7, 'HTTP'],
    ]);
    expect(d.layers.at(-1)!.text).toContain('GET /index.html HTTP/1.1');
  });

  it('DHCP-Discover hat das richtige BOOTP-Format (300+ Bytes, Magic Cookie)', () => {
    const { sim } = busy();
    const discover = sim.getPacketLog().find((e) => e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'udp' && e.frame.payload.payload.payload.kind === 'dhcp')!;
    const d = dissect(discover.frame);
    const dhcp = d.layers.find((l) => l.protocol === 'DHCP')!;
    expect(dhcp.length).toBeGreaterThanOrEqual(240);
    expect(Array.from(d.bytes.slice(dhcp.start + 236, dhcp.start + 240))).toEqual([0x63, 0x82, 0x53, 0x63]);
  });

  it('pcapng-Export beginnt mit Section Header und enthält alle Ethernet-Rahmen', () => {
    const { net, sim } = busy();
    const bytes = toPcapng(net.topology, sim.getPacketLog());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x0a, 0x0d, 0x0d, 0x0a]);
    expect(Array.from(bytes.slice(8, 12))).toEqual([0x4d, 0x3c, 0x2b, 0x1a]);
    let count = 0;
    for (let i = 0; i < bytes.length; ) {
      const type = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
      const length = bytes[i + 4]! | (bytes[i + 5]! << 8) | (bytes[i + 6]! << 16) | (bytes[i + 7]! << 24);
      if (type === 6) count++;
      expect(length % 4).toBe(0);
      i += length;
    }
    expect(count).toBe(sim.getPacketLog().length);
  });

  it('Modem-Steuermeldungen werden angezeigt (DOCSIS mit Linktyp)', () => {
    const net = new NetBuilder();
    const added = unwrap(addDevice(net.topology, 'modem', 'Kabelmodem', { x: 0, y: 0 }, { modem: 'cable' }));
    net.topology = added.topology;
    const isp = net.internet('Provider', ['203.0.113.1/30', '198.51.100.1/24']);
    const r = net.router('R', ['192.168.1.1/24', '203.0.113.2/30']);
    net.link(r, added.id);
    net.link(added.id, isp, 'coax');
    const sim = new Simulation(net.topology);
    sim.runUntil(1000);
    const first = sim.getPacketLog()[0]!;
    const d = dissect(first.frame, 'coax');
    expect(d.layers.map((l) => l.protocol)).toEqual(['DOCSIS 3.1 PHY', 'DOCSIS', 'DOCSIS MAC-Management MDD']);
    expect(d.linkType).toBe(143);
  });
});
