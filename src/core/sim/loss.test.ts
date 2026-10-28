import { describe, expect, it } from 'vitest';
import { setCableLoss } from '../model/topology';
import { Simulation } from './simulation';
import { NetBuilder, unwrap } from './testing';

function twoHosts(loss: number) {
  const net = new NetBuilder();
  const a = net.host('A', '10.0.0.1');
  const b = net.host('B', '10.0.0.2');
  const cable = net.link(a, b);
  net.topology = unwrap(setCableLoss(net.topology, cable, loss));
  return { net, a, b, cable };
}

const run = (net: NetBuilder, a: string) => {
  const sim = new Simulation(net.topology);
  sim.ping(a, '10.0.0.2');
  sim.runUntilIdle();
  return sim;
};

describe('Beschädigte Kabel', () => {
  it('verlieren bei 100 % alles', () => {
    const { net, a } = twoHosts(100);
    const sim = run(net, a);
    expect(sim.getPacketLog().every((e) => e.status === 'lost' && e.lostBecause === 'damaged')).toBe(true);
    expect(sim.getDeviceState(a).console.at(-1)?.params).toMatchObject({ received: 0 });
  });

  it('verlieren bei 50 % einen Teil, immer denselben', () => {
    const { net, a } = twoHosts(50);
    const first = run(net, a).getPacketLog().map((e) => e.status);
    const second = run(net, a).getPacketLog().map((e) => e.status);
    expect(first).toEqual(second);
    expect(first).toContain('lost');
    expect(first).toContain('delivered');
  });

  it('führen bei TCP zu Wiederholungen, die Seite kommt trotzdem an', () => {
    const net = new NetBuilder();
    const client = net.host('Client', '10.0.0.1');
    const web = net.host('Web', '10.0.0.2');
    net.webServer(web, { '/index.html': 'ok' });
    const cable = net.link(client, web);
    net.topology = unwrap(setCableLoss(net.topology, cable, 25));
    const sim = new Simulation(net.topology);
    // Zuerst ARP-Einträge per Ping gewinnen, damit der Abruf nicht schon an ARP scheitert.
    sim.ping(client, '10.0.0.2');
    sim.runUntilIdle();
    expect(sim.getDeviceState(client).arp).toHaveLength(1);
    sim.browse(client, 'http://10.0.0.2/');
    sim.runUntilIdle();
    const segments = sim
      .getPacketLog()
      .flatMap((e) => (e.frame.payload.kind === 'ipv4' && e.frame.payload.payload.kind === 'tcp' ? [`${e.from.device}:${e.frame.payload.payload.seq}:${e.frame.payload.payload.flags}`] : []));
    expect(new Set(segments).size).toBeLessThan(segments.length);
    expect(sim.getDeviceState(client).browser?.response?.body).toBe('ok');
  });

  it('prüft den Wert und speichert ihn in der Projektdatei', () => {
    const { net, cable } = twoHosts(30);
    expect(net.topology.cables[0]!.loss).toBe(30);
    expect(setCableLoss(net.topology, cable, 101)).toMatchObject({ ok: false, error: { code: 'invalidLoss' } });
    expect('loss' in unwrap(setCableLoss(net.topology, cable, 0)).cables[0]!).toBe(false);
  });
});
