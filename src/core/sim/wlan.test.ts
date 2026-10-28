import { describe as group, expect, it } from 'vitest';
import { linkStatus } from '../model/links';
import {
  addFloor,
  configureHost,
  connect,
  moveDevice,
  replugCable,
  setCableMedium,
  setDeviceFloor,
  setInterfaceShutdown,
  setWifiClient,
  setWlan,
} from '../model/topology';
import { parseProject, serializeProject } from '../io/project';
import { Simulation } from './simulation';
import { NetBuilder, unwrap } from './testing';

const replies = (sim: Simulation, id: string) => sim.getDeviceState(id).console.filter((l) => l.code === 'ping.reply').length;

function wifiNet() {
  const net = new NetBuilder();
  const server = net.host('Server', '192.168.1.10');
  const ap = net.add('accesspoint', 'AP1');
  const nb = net.add('notebook', 'NB1');
  net.topology = unwrap(setWifiClient(net.topology, nb, { ssid: 'Schule', password: 'geheim123' }));
  net.topology = unwrap(configureHost(net.topology, nb, { ip: '192.168.1.20', mask: '24' }));
  net.topology = unwrap(setWlan(net.topology, ap, { ssid: 'Schule', password: 'geheim123', band: '5', channel: 36 }));
  net.link(server, ap);
  const { topology, id: radio } = unwrap(connect(net.topology, nb, ap, 'wireless'));
  net.topology = topology;
  return { net, server, ap, nb, radio };
}

group('WLAN', () => {
  it('verbindet ein Notebook per Funk mit dem Access Point', () => {
    const { net, nb, ap, radio } = wifiNet();
    const cable = net.topology.cables.find((c) => c.id === radio)!;
    expect(cable.medium).toBe('wireless');
    // Funk landet auf einem Funk-Port (> 0), das Kabel auf der LAN-Buchse.
    expect(cable.a.device === ap ? cable.a.iface : cable.b.iface).toBeGreaterThan(0);
    expect(linkStatus(net.topology, cable)).toMatchObject({ up: true });
    const sim = new Simulation(net.topology);
    sim.ping(nb, '192.168.1.10');
    sim.runUntilIdle();
    expect(replies(sim, nb)).toBe(4);
  });

  it('kommt mit falschem Passwort nicht ins Netz', () => {
    const { net, nb, radio } = wifiNet();
    net.topology = unwrap(setWifiClient(net.topology, nb, { ssid: 'Schule', password: 'falsch123' }));
    expect(linkStatus(net.topology, net.topology.cables.find((c) => c.id === radio)!)).toMatchObject({ up: false, reason: 'wrongPassword' });
    const sim = new Simulation(net.topology);
    sim.ping(nb, '192.168.1.10');
    sim.runUntilIdle();
    expect(replies(sim, nb)).toBe(0);
  });

  it('verliert die Verbindung ausser Reichweite', () => {
    const { net, nb, radio } = wifiNet();
    net.topology = unwrap(moveDevice(net.topology, nb, { x: 2000, y: 0 }));
    expect(linkStatus(net.topology, net.topology.cables.find((c) => c.id === radio)!)).toMatchObject({ up: false, reason: 'outOfRange' });
  });

  it('erlaubt Funk nur mit Access Point und nur an Funk-Ports', () => {
    const net = new NetBuilder();
    const a = net.host('A', '10.0.0.1');
    const b = net.host('B', '10.0.0.2');
    expect(connect(net.topology, a, b, 'wireless')).toMatchObject({ ok: false, error: { code: 'wirelessNeedsAccessPoint' } });
    const { net: n2, radio, ap } = wifiNet();
    const cable = n2.topology.cables.find((c) => c.id === radio)!;
    const end = cable.a.device === ap ? 'a' : 'b';
    expect(replugCable(n2.topology, radio, end, 0)).toMatchObject({ ok: false, error: { code: 'radioPortNeedsWireless' } });
    expect(setCableMedium(n2.topology, radio, 'tp')).toMatchObject({ ok: false });
  });
});

group('Mesh über Stockwerke', () => {
  it('verbindet zwei Mesh-Access-Points und dämpft pro Stockwerk', () => {
    const { net, ap } = wifiNet();
    const ap2 = net.add('accesspoint', 'AP2');
    net.topology = unwrap(addFloor(net.topology, 'OG'));
    net.topology = unwrap(setDeviceFloor(net.topology, ap2, 1));
    const mesh = { ssid: 'Schule', password: 'geheim123', band: '5' as const, channel: 36, mesh: true };
    net.topology = unwrap(setWlan(net.topology, ap, mesh));
    net.topology = unwrap(setWlan(net.topology, ap2, mesh));
    const { topology, id: backhaul } = unwrap(connect(net.topology, ap, ap2, 'wireless'));
    net.topology = topology;
    const status = linkStatus(net.topology, net.topology.cables.find((c) => c.id === backhaul)!);
    expect(status.up).toBe(true);
    expect(status.signal).toBeLessThanOrEqual(65);

    // Notebook im Obergeschoss hängt am zweiten AP und erreicht den Server im EG.
    const nb2 = net.add('notebook', 'NB2');
    net.topology = unwrap(configureHost(net.topology, nb2, { ip: '192.168.1.30', mask: '24' }));
    net.topology = unwrap(setWifiClient(net.topology, nb2, { ssid: 'Schule', password: 'geheim123' }));
    net.topology = unwrap(setDeviceFloor(net.topology, nb2, 1));
    net.topology = unwrap(connect(net.topology, nb2, ap2, 'wireless')).topology;
    const sim = new Simulation(net.topology);
    sim.ping(nb2, '192.168.1.10');
    sim.runUntilIdle();
    expect(replies(sim, nb2)).toBe(4);

    const parsed = parseProject(serializeProject(net.topology));
    expect(parsed.ok && parsed.topology).toEqual(net.topology);
  });

  it('braucht den Mesh-Betrieb auf beiden Seiten', () => {
    const { net, ap } = wifiNet();
    const ap2 = net.add('accesspoint', 'AP2');
    net.topology = unwrap(setWlan(net.topology, ap2, { ssid: 'Schule', password: 'geheim123', band: '5', channel: 36 }));
    const { topology, id } = unwrap(connect(net.topology, ap, ap2, 'wireless'));
    expect(linkStatus(topology, topology.cables.find((c) => c.id === id)!)).toMatchObject({ up: false, reason: 'meshDisabled' });
  });
});

group('Abgeschaltete Anschlüsse', () => {
  it('überträgt nichts über einen Port mit «shutdown»', () => {
    const net = new NetBuilder();
    const a = net.host('A', '10.0.0.1');
    const b = net.host('B', '10.0.0.2');
    const sw = net.add('switch', 'S1');
    net.link(a, sw);
    net.link(b, sw);
    net.topology = unwrap(setInterfaceShutdown(net.topology, sw, 1, true));
    const sim = new Simulation(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    expect(replies(sim, a)).toBe(0);
    net.topology = unwrap(setInterfaceShutdown(net.topology, sw, 1, false));
    sim.updateTopology(net.topology);
    sim.ping(a, '10.0.0.2');
    sim.runUntilIdle();
    expect(replies(sim, a)).toBe(4);
  });
});
