import { describe as group, expect, it } from 'vitest';
import { WAN_MEDIUM } from '../model/links';
import { addDevice } from '../model/topology';
import { MODEM_KINDS, type ModemKind } from '../model/types';
import { ACCESS_PROFILES } from './access';
import { Simulation } from './simulation';
import { NetBuilder, unwrap } from './testing';

/** PC – Heimrouter (NAT) – Modem (Technik) – Internet (Provider) – Webserver */
function home(kind: ModemKind) {
  const net = new NetBuilder();
  const pc = net.host('PC', '192.168.1.10', '24', '192.168.1.1');
  const router = net.router('Heimrouter', ['192.168.1.1/24', '203.0.113.2/30']);
  net.nat(router, 1);
  net.route(router, '0.0.0.0', '0', '203.0.113.1');
  const added = unwrap(addDevice(net.topology, 'modem', 'Modem', { x: 0, y: 0 }, { modem: kind }));
  net.topology = added.topology;
  const modem = added.id;
  const isp = net.internet('Provider', ['203.0.113.1/30', '198.51.100.1/24']);
  const server = net.host('Server', '198.51.100.10', '24', '198.51.100.1');
  net.link(pc, router);
  net.link(router, modem);
  net.link(modem, isp, WAN_MEDIUM[kind]);
  net.link(isp, server);
  return { net, pc, modem, isp };
}

group('Zugangstechniken', () => {
  for (const kind of MODEM_KINDS) {
    it(`${kind}: baut die Leitung nach Norm auf, danach fliessen Nutzdaten in der Zugangstechnik`, () => {
      const { net, pc, modem, isp } = home(kind);
      const sim = new Simulation(net.topology);
      // Vor dem Aufbau kommt nichts durch.
      sim.ping(pc, '198.51.100.10');
      sim.runUntil(3);
      sim.runUntil(5000);
      const control = sim.getPacketLog().filter((e) => e.frame.payload.kind === 'link');
      const messages = control.map((e) => (e.frame.payload.kind === 'link' ? e.frame.payload.message : ''));
      expect(messages).toEqual(ACCESS_PROFILES[kind].steps.map((s) => s.message));
      // Richtung stimmt: jede Meldung kommt von der richtigen Seite.
      control.forEach((e, i) => expect(e.from.device).toBe(ACCESS_PROFILES[kind].steps[i]!.from === 'cpe' ? modem : isp));
      expect(sim.getDeviceState(modem).modem).toMatchObject({ phase: 'online' });

      sim.ping(pc, '198.51.100.10');
      sim.runUntil(30_000);
      expect(sim.getDeviceState(pc).console.filter((l) => l.code === 'ping.reply').length).toBeGreaterThan(0);
      const wan = sim.getPacketLog().filter((e) => e.frame.payload.kind === 'ipv4' && (e.from.device === modem || e.to.device === modem) && (e.from.device === isp || e.to.device === isp));
      expect(wan.length).toBeGreaterThan(0);
      expect(wan.every((e) => e.frame.access === ACCESS_PROFILES[kind].data)).toBe(true);
    });
  }
});
