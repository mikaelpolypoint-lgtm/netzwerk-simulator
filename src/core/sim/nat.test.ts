import { describe as group, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

/**
 * Heimnetz 192.168.0.0/24 (PC, NAS an Switch) – Heimrouter mit NAT auf eth1
 * (203.0.113.2/30) – Internet – öffentlicher Webserver und ein Rechner «Aussen».
 */
function network({ nat = true } = {}) {
  const net = new NetBuilder();
  const pc = net.host('PC', '192.168.0.10', '24', '192.168.0.1');
  const nas = net.host('NAS', '192.168.0.20', '24', '192.168.0.1');
  net.webServer(nas, { '/index.html': 'von innen' });
  const sw = net.add('switch', 'S1');
  const home = net.router('Heimrouter', ['192.168.0.1/24', '203.0.113.2/30']);
  if (nat) net.nat(home, 1);
  net.route(home, '0.0.0.0', '0', '203.0.113.1');
  const internet = net.internet('Internet', ['203.0.113.1/30', '198.51.100.1/24']);
  const web = net.host('Webserver', '198.51.100.10', '24', '198.51.100.1');
  net.webServer(web, { '/index.html': 'öffentlich' });
  const outsider = net.host('Aussen', '198.51.100.20', '24', '198.51.100.1');
  const sw2 = net.add('switch', 'S2');
  net.link(pc, sw);
  net.link(nas, sw);
  net.link(sw, home);
  net.link(home, internet);
  net.link(internet, sw2);
  net.link(web, sw2);
  net.link(outsider, sw2);
  return { net, pc, nas, home, internet, outsider };
}

const log = (net: NetBuilder, sim: Simulation) => sim.getPacketLog().map((e) => describe(net.topology, e));
const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply');

group('Internet und NAT', () => {
  it('bringt ein privates Heimnetz ins Internet und zurück', () => {
    const { net, pc, home } = network();
    const sim = new Simulation(net.topology);
    sim.ping(pc, '198.51.100.10');
    sim.runUntilIdle();
    expect(replies(sim, pc)).toHaveLength(4);
    // Im Internet erscheint nur die öffentliche Adresse des Heimrouters.
    expect(log(net, sim)).toContain('S2→Webserver ICMP echoRequest 203.0.113.2>198.51.100.10');
    expect(log(net, sim)).toContain('S1→PC ICMP echoReply 198.51.100.10>192.168.0.10');
    expect(sim.getDeviceState(home).nat).toMatchObject([{ protocol: 'icmp', inside: '192.168.0.10', outside: '203.0.113.2', outsidePort: 50000 }]);
  });

  it('übersetzt bei TCP auch den Port', () => {
    const { net, pc } = network();
    const sim = new Simulation(net.topology);
    sim.browse(pc, 'http://198.51.100.10/');
    sim.runUntilIdle();
    expect(sim.getDeviceState(pc).browser?.response?.body).toBe('öffentlich');
    expect(log(net, sim).some((l) => l.startsWith('Internet→S2 TCP 50000>80 [SYN]'))).toBe(true);
    expect(log(net, sim).some((l) => l.startsWith('S1→PC TCP 80>49152 [SYN,ACK]'))).toBe(true);
  });

  it('verwirft ohne NAT private Absender im Internet', () => {
    const { net, pc, internet } = network({ nat: false });
    const sim = new Simulation(net.topology);
    sim.ping(pc, '198.51.100.10');
    sim.runUntilIdle();
    expect(replies(sim, pc)).toHaveLength(0);
    expect(sim.getDeviceState(internet).console[0]).toMatchObject({ code: 'internet.private', params: { src: '192.168.0.10' } });
  });

  it('lässt von aussen nichts ins Heimnetz – ausser über eine Portweiterleitung', () => {
    const { net, home, outsider } = network();
    let sim = new Simulation(net.topology);
    sim.browse(outsider, 'http://203.0.113.2/');
    sim.runUntilIdle();
    // Wie bei echten Heimroutern: ohne Weiterleitung keine Antwort, die Verbindung läuft ins Leere.
    expect(sim.getDeviceState(outsider).browser?.steps.at(-1)?.code).toBe('browser.tcp.timeout');

    net.portForward(home, 80, '192.168.0.20');
    sim = new Simulation(net.topology);
    sim.browse(outsider, 'http://203.0.113.2/');
    sim.runUntilIdle();
    expect(sim.getDeviceState(outsider).browser?.response?.body).toBe('von innen');
    expect(sim.getDeviceState(home).console.map((l) => l.code)).toContain('nat.forward');
  });

  it('beantwortet Pings an die eigene Internet-Adresse selbst', () => {
    const { net, home, outsider } = network();
    const sim = new Simulation(net.topology);
    sim.ping(outsider, '203.0.113.2');
    sim.runUntilIdle();
    expect(replies(sim, outsider)).toHaveLength(4);
    expect(sim.getDeviceState(home).nat).toEqual([]);
  });
});
