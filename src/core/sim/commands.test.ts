import { describe as group, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { NetBuilder } from './testing';

const lines = (sim: Simulation, id: string) => sim.getDeviceState(id).console;
const codes = (sim: Simulation, id: string) => lines(sim, id).map((l) => l.code);

/** PC1 – R1 – R2 – PC2 */
function chain() {
  const net = new NetBuilder();
  const pc1 = net.host('PC1', '192.168.1.10', '24', '192.168.1.1');
  const r1 = net.router('R1', ['192.168.1.1/24', '172.16.0.1/30']);
  const r2 = net.router('R2', ['172.16.0.2/30', '192.168.2.1/24']);
  const pc2 = net.host('PC2', '192.168.2.10', '24', '192.168.2.1');
  net.link(pc1, r1);
  net.link(r1, r2);
  net.link(r2, pc2);
  net.route(r1, '192.168.2.0', '24', '172.16.0.2');
  net.route(r2, '192.168.1.0', '24', '172.16.0.1');
  return { net, pc1, pc2 };
}

group('Traceroute', () => {
  it('nennt jeden Router auf dem Weg und zuletzt das Ziel', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.traceroute(pc1, '192.168.2.10');
    sim.runUntilIdle();

    const hops = lines(sim, pc1).filter((l) => l.code === 'tracert.hop');
    expect(hops.map((l) => [l.params?.hop, l.params?.from])).toEqual([
      [1, '192.168.1.1'],
      [2, '172.16.0.2'],
      [3, '192.168.2.10'],
    ]);
    expect(codes(sim, pc1).at(-1)).toBe('tracert.done');
  });

  it('meldet fehlende Routen unterwegs', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.traceroute(pc1, '10.0.0.1');
    sim.runUntilIdle();
    // Hop 1: R1 meldet "TTL abgelaufen"; Hop 2: R1 kennt kein Netz 10.x.
    expect(codes(sim, pc1)).toEqual(['tracert.start', 'tracert.hop', 'tracert.netUnreachable', 'tracert.done']);
  });
});

group('Befehlszeile', () => {
  it('führt ping und tracert aus', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.runCommand(pc1, 'ping 192.168.2.10');
    sim.runUntilIdle();
    expect(codes(sim, pc1).filter((c) => c === 'ping.reply')).toHaveLength(4);
    expect(lines(sim, pc1)[0]).toMatchObject({ code: 'cmd.echo', params: { line: 'ping 192.168.2.10' } });
  });

  it('zeigt die Konfiguration mit ipconfig', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.runCommand(pc1, 'ipconfig');
    expect(lines(sim, pc1).slice(1)).toMatchObject([
      { code: 'ipconfig.adapter', params: { name: 'PC1', mac: '02:00:00:00:01:00' } },
      { code: 'ipconfig.mode.static' },
      { code: 'ipconfig.ip', params: { ip: '192.168.1.10' } },
      { code: 'ipconfig.mask', params: { mask: '255.255.255.0', prefix: 24 } },
      { code: 'ipconfig.gateway', params: { gateway: '192.168.1.1' } },
      { code: 'ipconfig.dns', params: { dns: '–' } },
    ]);
  });

  it('zeigt und leert den ARP-Cache', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.runCommand(pc1, 'arp -a');
    sim.ping(pc1, '192.168.1.1');
    sim.runUntilIdle();
    sim.runCommand(pc1, 'arp -a');
    sim.runCommand(pc1, 'arp -d');
    sim.runCommand(pc1, 'arp');
    const arpCodes = codes(sim, pc1).filter((c) => c.startsWith('arp.'));
    expect(arpCodes).toEqual(['arp.empty', 'arp.header', 'arp.entry', 'arp.cleared', 'arp.empty']);
  });

  it('kennt Hilfe, Leeren und unbekannte Befehle', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.runCommand(pc1, 'format c:');
    expect(lines(sim, pc1).at(-1)).toMatchObject({ code: 'cmd.unknown', params: { cmd: 'format' } });
    sim.runCommand(pc1, 'help');
    expect(codes(sim, pc1).filter((c) => c.startsWith('help.'))).toHaveLength(6);
    sim.runCommand(pc1, 'cls');
    expect(lines(sim, pc1)).toEqual([]);
    sim.runCommand(pc1, 'ping');
    expect(codes(sim, pc1).at(-1)).toBe('cmd.usage.ping');
  });

  it('weist ipconfig /renew bei statischer Konfiguration zurück', () => {
    const { net, pc1 } = chain();
    const sim = new Simulation(net.topology);
    sim.runCommand(pc1, 'ipconfig /renew');
    expect(codes(sim, pc1).at(-1)).toBe('dhcp.static');
  });
});
