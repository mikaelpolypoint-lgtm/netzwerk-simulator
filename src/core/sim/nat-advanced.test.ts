import { describe as group, expect, it } from 'vitest';
import { addStaticNat, setCgnat, setCgnatAddress } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, describe } from './testing';

const log = (net: NetBuilder, sim: Simulation) => sim.getPacketLog().map((e) => describe(net.topology, e));
const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply');

/** Firmennetz – Router (WAN /29 mit mehreren öffentlichen Adressen) – Internet – Aussen */
function company() {
  const net = new NetBuilder();
  const pc = net.host('PC', '192.168.0.10', '24', '192.168.0.1');
  const web = net.host('Webserver', '192.168.0.80', '24', '192.168.0.1');
  const sw = net.add('switch', 'S1');
  const router = net.router('Firmenrouter', ['192.168.0.1/24', '203.0.113.2/29']);
  net.nat(router, 1);
  net.route(router, '0.0.0.0', '0', '203.0.113.1');
  net.apply((t) => addStaticNat(t, router, { inside: '192.168.0.80', outside: '203.0.113.5' }));
  const internet = net.internet('Internet', ['203.0.113.1/29', '198.51.100.1/24']);
  const outsider = net.host('Aussen', '198.51.100.20', '24', '198.51.100.1');
  net.link(pc, sw);
  net.link(web, sw);
  net.link(sw, router);
  net.link(router, internet);
  net.link(internet, outsider);
  return { net, pc, web, router, outsider };
}

group('Statisches NAT (1:1)', () => {
  it('macht einen internen Server unter eigener öffentlicher Adresse erreichbar', () => {
    const { net, outsider } = company();
    const sim = new Simulation(net.topology);
    sim.ping(outsider, '203.0.113.5');
    sim.runUntil(20_000);
    expect(replies(sim, outsider)).toHaveLength(4);
    // Proxy-ARP: Der Router antwortet für 203.0.113.5.
    expect(log(net, sim)).toContain('Firmenrouter→Internet ARP reply 203.0.113.1');
    expect(log(net, sim)).toContain('S1→Webserver ICMP echoRequest 198.51.100.20>192.168.0.80');
  });

  it('ausgehend erscheint der Server mit seiner festen Adresse, andere mit der Router-Adresse', () => {
    const { net, web, pc } = company();
    const sim = new Simulation(net.topology);
    sim.ping(web, '198.51.100.20');
    sim.ping(pc, '198.51.100.20');
    sim.runUntil(20_000);
    expect(log(net, sim)).toContain('Internet→Aussen ICMP echoRequest 203.0.113.5>198.51.100.20');
    expect(log(net, sim)).toContain('Internet→Aussen ICMP echoRequest 203.0.113.2>198.51.100.20');
  });
});

/** Heimnetz – Heimrouter (WAN 100.64.0.2) – Provider mit CGNAT (192.0.2.1) – Aussen */
function cgnat({ enabled = true } = {}) {
  const net = new NetBuilder();
  const pc = net.host('PC', '192.168.1.10', '24', '192.168.1.1');
  const home = net.router('Heimrouter', ['192.168.1.1/24', '100.64.0.2/24']);
  net.nat(home, 1);
  net.route(home, '0.0.0.0', '0', '100.64.0.1');
  const isp = net.internet('Provider', ['100.64.0.1/24', '198.51.100.1/24']);
  if (enabled) {
    net.apply((t) => setCgnat(t, isp, 0, true));
    net.apply((t) => setCgnatAddress(t, isp, '192.0.2.1'));
  }
  const outsider = net.host('Aussen', '198.51.100.20', '24', '198.51.100.1');
  net.link(pc, home);
  net.link(home, isp);
  net.link(isp, outsider);
  return { net, pc, home, isp, outsider };
}

group('Carrier-Grade NAT', () => {
  it('übersetzt zweimal: im Heimrouter und beim Provider', () => {
    const { net, pc, home, isp } = cgnat();
    const sim = new Simulation(net.topology);
    sim.ping(pc, '198.51.100.20');
    sim.runUntil(20_000);
    expect(replies(sim, pc)).toHaveLength(4);
    expect(log(net, sim)).toContain('Heimrouter→Provider ICMP echoRequest 100.64.0.2>198.51.100.20');
    expect(log(net, sim)).toContain('Provider→Aussen ICMP echoRequest 192.0.2.1>198.51.100.20');
    expect(sim.getDeviceState(home).nat?.[0]).toMatchObject({ inside: '192.168.1.10', outside: '100.64.0.2' });
    expect(sim.getDeviceState(isp).nat?.[0]).toMatchObject({ inside: '100.64.0.2', outside: '192.0.2.1', kind: 'cgnat' });
  });

  it('ohne CGNAT verwirft der Provider Adressen aus 100.64.0.0/10', () => {
    const { net, pc } = cgnat({ enabled: false });
    const sim = new Simulation(net.topology);
    sim.ping(pc, '198.51.100.20');
    sim.runUntil(20_000);
    expect(replies(sim, pc)).toHaveLength(0);
  });

  it('von aussen kommt man nicht hinein: keine Portweiterleitung durch CGNAT', () => {
    const { net, outsider } = cgnat();
    const sim = new Simulation(net.topology);
    sim.ping(outsider, '192.0.2.1');
    sim.runUntil(20_000);
    // Der Provider selbst antwortet, aber niemand dahinter ist erreichbar.
    expect(log(net, sim).filter((l) => l.startsWith('Provider→Heimrouter ICMP'))).toHaveLength(0);
  });
});
