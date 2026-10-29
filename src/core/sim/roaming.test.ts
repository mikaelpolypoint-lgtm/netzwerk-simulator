import { describe as group, expect, it } from 'vitest';
import { applyRoaming, moveDevice, roamingTarget, setWifiClient, setWlan } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, describe, unwrap } from './testing';

/** Server – Switch – AP1 (links) und AP2 (rechts), gleiche SSID; Notebook beginnt bei AP1. */
function campus() {
  const net = new NetBuilder();
  const server = net.host('Server', '10.0.0.1');
  const sw = net.add('switch', 'SW');
  const ap1 = net.add('accesspoint', 'AP1');
  const ap2 = net.add('accesspoint', 'AP2');
  const nb = net.host('NB', '10.0.0.50');
  net.topology = unwrap(moveDevice(net.topology, ap1, { x: 0, y: 0 }));
  net.topology = unwrap(moveDevice(net.topology, ap2, { x: 1000, y: 0 }));
  net.topology = unwrap(moveDevice(net.topology, nb, { x: 100, y: 0 }));
  const wlan = { ssid: 'Firma', password: 'geheim123', band: '5' as const, channel: 36 };
  net.topology = unwrap(setWlan(net.topology, ap1, wlan));
  net.topology = unwrap(setWlan(net.topology, ap2, { ...wlan, channel: 44 }));
  net.topology = unwrap(setWifiClient(net.topology, nb, { ssid: 'Firma', password: 'geheim123' }));
  net.link(server, sw);
  net.link(sw, ap1);
  net.link(sw, ap2);
  net.link(nb, ap1, 'wireless');
  return { net, server, ap1, ap2, nb };
}

group('WLAN-Anmeldung und Roaming', () => {
  it('meldet sich nach 802.11 an: Probe, Authentication, Association, 4-Way-Handshake', () => {
    const { net } = campus();
    const sim = new Simulation(net.topology);
    sim.runUntil(100);
    const wlan = sim.getPacketLog().filter((e) => e.frame.payload.kind === 'link').map((e) => describe(net.topology, e));
    expect(wlan).toEqual([
      'NB→AP1 802.11 Probe Request',
      'AP1→NB 802.11 Probe Response',
      'NB→AP1 802.11 Authentication',
      'AP1→NB 802.11 Authentication',
      'NB→AP1 802.11 Association Request',
      'AP1→NB 802.11 Association Response',
      'AP1→NB 802.11 EAPOL-Key 1/4',
      'NB→AP1 802.11 EAPOL-Key 2/4',
      'AP1→NB 802.11 EAPOL-Key 3/4',
      'NB→AP1 802.11 EAPOL-Key 4/4',
    ].map((l) => l.replace('802.11', 'WLAN')));
  });

  it('wechselt beim Verschieben zum näheren Access Point und bleibt erreichbar', () => {
    const { net, server, ap2, nb } = campus();
    const sim = new Simulation(net.topology);
    sim.ping(server, '10.0.0.50');
    sim.runUntil(10_000);
    expect(roamingTarget(net.topology, nb)).toBeNull();
    net.topology = unwrap(moveDevice(net.topology, nb, { x: 900, y: 0 }));
    const decision = roamingTarget(net.topology, nb)!;
    expect(decision).toMatchObject({ to: ap2 });
    net.topology = unwrap(applyRoaming(net.topology, decision));
    sim.updateTopology(net.topology);
    sim.reassociate(nb);
    sim.runUntil(10_100);
    const log = sim.getPacketLog().map((e) => describe(net.topology, e));
    expect(log).toContain('NB→AP2 WLAN Reassociation Request');
    // Gratuitous ARP: Der Switch lernt den neuen Weg.
    expect(log).toContain('AP2→SW ARP request 10.0.0.50');
    const before = sim.getDeviceState(server).console.filter((l) => l.code === 'ping.reply').length;
    sim.ping(server, '10.0.0.50');
    sim.runUntil(20_000);
    expect(sim.getDeviceState(server).console.filter((l) => l.code === 'ping.reply').length).toBe(before + 4);
  });
});
